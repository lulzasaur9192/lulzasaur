import type { LLMProvider } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("llm-registry");

const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.name, provider);
  log.debug({ provider: provider.name }, "Registered LLM provider");
}

export function getProvider(name: string): LLMProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`LLM provider "${name}" not registered. Available: ${[...providers.keys()].join(", ")}`);
  }
  return provider;
}

export function initializeDefaultProviders(): void {
  const anthropicToken = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (anthropicToken) {
    registerProvider(new AnthropicProvider(anthropicToken));
  }
  if (process.env.OPENAI_API_KEY) {
    registerProvider(new OpenAIProvider());
  }
}

export function listProviders(): string[] {
  return [...providers.keys()];
}
