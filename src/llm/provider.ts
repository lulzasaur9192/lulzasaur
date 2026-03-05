import type { LLMMessage, LLMTool, LLMResponse } from "../core/types.js";

export interface LLMProviderOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: LLMTool[];
}

export interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], options: LLMProviderOptions): Promise<LLMResponse>;
  countTokens(text: string): number;
}
