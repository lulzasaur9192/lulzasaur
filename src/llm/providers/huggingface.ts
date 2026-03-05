import OpenAI from "openai";
import type { LLMProvider, LLMProviderOptions } from "../provider.js";
import type { LLMMessage, LLMResponse, LLMContentBlock, LLMTool, TokenUsage } from "../../core/types.js";
import { LLMError } from "../../utils/errors.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("llm-huggingface");

// HuggingFace Inference API is OpenAI-compatible — we use the OpenAI SDK with a custom base URL.
// Tool calling is done via prompt injection (not the `tools` API parameter) because HF's
// router dispatches to third-party backends that don't reliably support OpenAI-style tool calls.
// We inject tool definitions into the system prompt and parse tool calls from the model's text output.
//
// Models available:
//   meta-llama/Llama-3.3-70B-Instruct       — strong general-purpose, free tier
//   Qwen/Qwen2.5-72B-Instruct               — strong reasoning, free tier
//   mistralai/Mistral-Small-24B-Instruct-2501 — fast and capable
//   microsoft/Phi-3-medium-128k-instruct     — lightweight, large context
//   NousResearch/Hermes-3-Llama-3.1-8B       — small and fast

const HF_BASE_URL = "https://router.huggingface.co/v1";

/**
 * Convert LLMTool[] into a system prompt suffix describing available tools
 * and the expected output format for tool calls.
 */
function buildToolPrompt(tools: LLMTool[]): string {
  const toolDescriptions = tools.map((t) =>
    `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.input_schema)}`
  ).join("\n\n");

  const toolNames = tools.map((t) => t.name).join(", ");

  return `\n\n## Available Tools\n\nYou have access to the following tools:\n\n${toolDescriptions}\n\n## How to call tools\n\nTo call a tool, output a JSON block wrapped in <tool_call> tags:\n\n<tool_call>\n{"name": "tool_name", "arguments": {"param1": "value1"}}\n</tool_call>\n\nIMPORTANT: The "name" field MUST be one of these exact tool names: ${toolNames}\nDo NOT use any other tool names. Do NOT invent tools like "bash_exec" or "run_command" — only use the exact names listed above.\n\nYou may call multiple tools in one response by using multiple <tool_call> blocks.\nAfter a tool is executed, you will receive the result. Use the result to continue your work.\nIf you don't need to call a tool, respond normally with text.`;
}

/**
 * Parse tool calls from model text output. Handles multiple formats:
 * - Format A: <tool_call>{"name": "...", "arguments": {...}}</tool_call>  (Hermes/instructed format)
 * - Format B: <function=name>{args}</function>  (Llama native format)
 */
function parseNativeToolCalls(text: string): { toolCalls: LLMContentBlock[]; cleanedText: string } {
  const toolCalls: LLMContentBlock[] = [];
  let cleanedText = text;

  // Format A: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  const hermesRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;
  while ((match = hermesRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!);
      toolCalls.push({
        type: "tool_use",
        id: `hf_${Math.random().toString(36).slice(2, 10)}`,
        name: parsed.name,
        input: parsed.arguments ?? parsed.parameters ?? {},
      });
    } catch { /* skip unparseable */ }
  }
  cleanedText = cleanedText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();

  // Format B (fallback): <function=name>{args}</function>  (Llama native)
  if (toolCalls.length === 0) {
    const llamaRegex = /<function=(\w+)>([\s\S]*?)<\/function>/g;
    while ((match = llamaRegex.exec(text)) !== null) {
      try {
        const input = JSON.parse(match[2]!);
        toolCalls.push({
          type: "tool_use",
          id: `hf_${Math.random().toString(36).slice(2, 10)}`,
          name: match[1]!,
          input,
        });
      } catch { /* skip */ }
    }
    cleanedText = cleanedText.replace(/<function=\w+>[\s\S]*?<\/function>/g, "").trim();
  }

  return { toolCalls, cleanedText };
}

export class HuggingFaceProvider implements LLMProvider {
  name = "huggingface";
  private client: OpenAI;

  constructor(apiKey?: string) {
    const token = apiKey ?? process.env.HF_TOKEN ?? process.env.HUGGINGFACE_API_KEY;
    if (!token) {
      throw new LLMError("No HuggingFace API token provided (set HF_TOKEN)", "huggingface");
    }

    this.client = new OpenAI({
      apiKey: token,
      baseURL: HF_BASE_URL,
    });

    log.debug("HuggingFace provider initialized");
  }

  async chat(messages: LLMMessage[], options: LLMProviderOptions): Promise<LLMResponse> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    // Inject tool definitions into system prompt instead of using the `tools` API parameter.
    // This avoids 400 errors from HF backends that don't support OpenAI-style tool calling.
    const systemWithTools = options.tools?.length
      ? (options.systemPrompt ?? "") + buildToolPrompt(options.tools)
      : options.systemPrompt;

    if (systemWithTools) {
      openaiMessages.push({ role: "system", content: systemWithTools });
    }

    for (const msg of messages) {
      if (msg.role === "system") continue;

      // Convert tool role messages to user messages with clear formatting,
      // since we're not using the `tools` API parameter.
      if (msg.role === "tool") {
        const toolCallId = (msg as any).toolCallId ?? "unknown";
        const resultContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        openaiMessages.push({
          role: "user",
          content: `[Tool result for call ${toolCallId}]:\n${resultContent}`,
        });
        continue;
      }

      if (typeof msg.content === "string") {
        openaiMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
        continue;
      }

      // Handle array content blocks — convert tool_use/tool_result to text format
      const textParts: string[] = [];
      const toolResultParts: string[] = [];

      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          // Convert tool_use blocks to text showing the tool call
          const callJson = JSON.stringify({ name: block.name, arguments: block.input });
          textParts.push(`<tool_call>\n${callJson}\n</tool_call>`);
        } else if (block.type === "tool_result") {
          toolResultParts.push(
            `[Tool result for ${block.tool_use_id ?? "unknown"}]:\n${block.content ?? ""}`
          );
        }
      }

      if (msg.role === "assistant") {
        // Assistant messages with tool_use blocks become text with <tool_call> tags
        openaiMessages.push({
          role: "assistant",
          content: textParts.join("\n") || "",
        });
        // Any tool results that were somehow in an assistant message go as user messages
        for (const r of toolResultParts) {
          openaiMessages.push({ role: "user", content: r });
        }
      } else {
        // User messages — combine text and any tool results
        const combined = [...textParts, ...toolResultParts].join("\n");
        if (combined) {
          openaiMessages.push({ role: "user", content: combined });
        }
      }
    }

    const MAX_RETRIES = 5;
    let lastError: unknown;

    const payloadStats = {
      model: options.model,
      messageCount: openaiMessages.length,
      toolCount: options.tools?.length ?? 0,
      estimatedChars: JSON.stringify(openaiMessages).length,
      hasSystemPrompt: !!systemWithTools,
      toolsInjected: !!options.tools?.length,
    };
    log.info(payloadStats, "HuggingFace request payload stats");

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoffMs = 3000 * Math.pow(2, attempt - 1);
        log.warn({ attempt, backoffMs, model: options.model }, "HuggingFace retrying after error");
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      try {
        // NO tools parameter — tool definitions are in the system prompt
        const response = await this.client.chat.completions.create({
          model: options.model,
          max_tokens: options.maxTokens ?? 4096,
          temperature: options.temperature,
          messages: openaiMessages,
        });

        const choice = response.choices[0]!;
        const content: LLMContentBlock[] = [];
        let stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn";

        if (choice.message.content) {
          // Try to parse tool calls from the text output
          const { toolCalls, cleanedText } = parseNativeToolCalls(choice.message.content);

          if (toolCalls.length > 0) {
            if (cleanedText) content.push({ type: "text", text: cleanedText });
            content.push(...toolCalls);
            stopReason = "tool_use";
            log.info({ model: options.model, count: toolCalls.length }, "Parsed tool calls from text");
          } else {
            content.push({ type: "text", text: choice.message.content });
          }
        }

        // Also handle any structured tool_calls (for backends that DO support them)
        if (choice.message.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            if (tc.type === "function") {
              content.push({
                type: "tool_use",
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse((tc.function.arguments || "{}").replace(/[\x00-\x1F\x7F]/g, (ch) => ch === "\n" || ch === "\t" ? ch : "")),
              });
              stopReason = "tool_use";
            }
          }
        }

        if (choice.finish_reason === "length") {
          stopReason = "max_tokens";
        }

        const usage: TokenUsage = {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        };

        log.debug({ model: options.model, usage, stopReason }, "HuggingFace response received");

        return { content, stopReason, usage, model: response.model };
      } catch (error) {
        const status = (error as any)?.status ?? (error as any)?.statusCode;
        const errorBody = (error as any)?.error ?? (error as any)?.message ?? String(error);
        log.error(
          { attempt, status, model: options.model, errorBody, payloadChars: payloadStats.estimatedChars },
          "HuggingFace API error",
        );
        if ((status === 429 || status === 500 || status === 503) && attempt < MAX_RETRIES - 1) {
          lastError = error;
          continue;
        }
        throw new LLMError(
          `HuggingFace API call failed (status ${status}): ${error instanceof Error ? error.message : String(error)}`,
          "huggingface",
          { model: options.model, status, payloadChars: payloadStats.estimatedChars },
        );
      }
    }

    throw new LLMError(
      `HuggingFace API call failed after ${MAX_RETRIES} retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      "huggingface",
      { model: options.model, payloadChars: payloadStats.estimatedChars },
    );
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
