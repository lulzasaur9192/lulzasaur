import OpenAI from "openai";
import type { LLMProvider, LLMProviderOptions } from "../provider.js";
import type { LLMMessage, LLMResponse, LLMContentBlock, TokenUsage } from "../../core/types.js";
import { LLMError } from "../../utils/errors.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("llm-openai");

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  }

  async chat(messages: LLMMessage[], options: LLMProviderOptions): Promise<LLMResponse> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    if (options.systemPrompt) {
      openaiMessages.push({ role: "system", content: options.systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "tool") {
        openaiMessages.push({
          role: "tool",
          tool_call_id: (msg as any).toolCallId ?? "unknown",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        });
        continue;
      }

      if (typeof msg.content === "string") {
        openaiMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
        continue;
      }

      // Handle array content blocks (tool use/results)
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
      let textParts: string[] = [];
      const toolResults: { tool_call_id: string; content: string }[] = [];

      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id ?? "",
            type: "function",
            function: { name: block.name ?? "", arguments: JSON.stringify(block.input) },
          });
        } else if (block.type === "tool_result") {
          toolResults.push({
            tool_call_id: block.tool_use_id ?? "",
            content: block.content ?? "",
          });
        }
      }

      if (toolCalls.length > 0) {
        openaiMessages.push({
          role: "assistant",
          content: textParts.join("\n") || null,
          tool_calls: toolCalls,
        });
      } else if (toolResults.length > 0) {
        for (const r of toolResults) {
          openaiMessages.push({ role: "tool", tool_call_id: r.tool_call_id, content: r.content });
        }
      } else {
        openaiMessages.push({ role: msg.role as "user" | "assistant", content: textParts.join("\n") });
      }
    }

    try {
      const response = await this.client.chat.completions.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        messages: openaiMessages,
        tools: options.tools?.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      });

      const choice = response.choices[0]!;
      const content: LLMContentBlock[] = [];

      if (choice.message.content) {
        content.push({ type: "text", text: choice.message.content });
      }

      if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.type === "function") {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || "{}"),
            });
          }
        }
      }

      const usage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      const stopReason = choice.finish_reason === "tool_calls"
        ? "tool_use" as const
        : choice.finish_reason === "length"
        ? "max_tokens" as const
        : "end_turn" as const;

      log.debug({ model: options.model, usage, stopReason }, "OpenAI response received");

      return { content, stopReason, usage, model: response.model };
    } catch (error) {
      throw new LLMError(
        `OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`,
        "openai",
        { model: options.model },
      );
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
