import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMProviderOptions } from "../provider.js";
import type { LLMMessage, LLMResponse, LLMContentBlock, TokenUsage } from "../../core/types.js";
import { LLMError } from "../../utils/errors.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("llm-anthropic");

function isOAuthToken(token: string): boolean {
  return token.includes("sk-ant-oat");
}

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(apiKeyOrToken?: string) {
    const token = apiKeyOrToken
      ?? process.env.ANTHROPIC_API_KEY
      ?? process.env.ANTHROPIC_AUTH_TOKEN;

    if (!token) {
      throw new LLMError("No Anthropic API key or OAuth token provided", "anthropic");
    }

    if (isOAuthToken(token)) {
      // OAuth token — use authToken param + Bearer auth
      log.debug("Using Anthropic OAuth token authentication");
      this.client = new Anthropic({
        apiKey: null as any,
        authToken: token,
        defaultHeaders: {
          "anthropic-beta": "oauth-2025-04-20",
        },
      });
    } else {
      // Standard API key
      log.debug("Using Anthropic API key authentication");
      this.client = new Anthropic({ apiKey: token });
    }
  }

  async chat(messages: LLMMessage[], options: LLMProviderOptions): Promise<LLMResponse> {
    const systemPrompt = options.systemPrompt
      ?? messages.find((m) => m.role === "system")?.content;

    const nonSystemMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => this.toAnthropicMessage(m));

    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 5s, 15s, 45s
        const backoffMs = 5000 * Math.pow(3, attempt - 1);
        log.warn({ attempt, backoffMs, model: options.model }, "Rate limited, retrying after backoff");
        await new Promise((r) => setTimeout(r, backoffMs));
      }

    try {
      const response = await this.client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        system: typeof systemPrompt === "string"
          ? [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }]
          : undefined,
        messages: nonSystemMessages,
        tools: options.tools?.map((t, i, arr) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool["input_schema"],
          ...(i === arr.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
        })),
      });

      const content: LLMContentBlock[] = response.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        if (block.type === "tool_use") {
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        return { type: "text" as const, text: "" };
      });

      const responseUsage = response.usage as unknown as Record<string, number>;
      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        cacheCreationInputTokens: responseUsage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: responseUsage.cache_read_input_tokens ?? 0,
      };

      const stopReason = response.stop_reason === "tool_use"
        ? "tool_use" as const
        : response.stop_reason === "max_tokens"
        ? "max_tokens" as const
        : "end_turn" as const;

      log.debug({ model: options.model, usage, stopReason }, "LLM response received");

      return { content, stopReason, usage, model: response.model };
    } catch (error) {
      // Retry on rate limit (429) or overloaded (529)
      const status = (error as any)?.status ?? (error as any)?.statusCode;
      if ((status === 429 || status === 529) && attempt < MAX_RETRIES - 1) {
        lastError = error;
        continue;
      }
      throw new LLMError(
        `Anthropic API call failed: ${error instanceof Error ? error.message : String(error)}`,
        "anthropic",
        { model: options.model },
      );
    }
    } // end retry loop

    throw new LLMError(
      `Anthropic API call failed after ${MAX_RETRIES} retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      "anthropic",
      { model: options.model },
    );
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private toAnthropicMessage(msg: LLMMessage): Anthropic.MessageParam {
    if (msg.role === "tool") {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: (msg as any).toolCallId ?? "unknown",
            content,
          },
        ],
      };
    }

    if (typeof msg.content === "string") {
      return { role: msg.role as "user" | "assistant", content: msg.content };
    }

    const blocks = msg.content.map((block): Anthropic.ContentBlockParam => {
      if (block.type === "text") {
        return {
          type: "text",
          text: block.text ?? "",
          ...(block.cache_control ? { cache_control: block.cache_control } : {}),
        };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id ?? "",
          name: block.name ?? "",
          input: block.input as Record<string, unknown>,
          ...(block.cache_control ? { cache_control: block.cache_control } : {}),
        };
      }
      if (block.type === "tool_result") {
        return {
          type: "tool_result",
          tool_use_id: block.tool_use_id ?? "",
          content: block.content ?? "",
          ...(block.cache_control ? { cache_control: block.cache_control } : {}),
        };
      }
      return { type: "text", text: "" };
    });

    return { role: msg.role as "user" | "assistant", content: blocks };
  }
}
