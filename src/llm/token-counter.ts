import type { LLMMessage } from "../core/types.js";

/**
 * Rough token counting. Good enough for budgeting — we reconcile with
 * actual usage from provider responses.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    } else {
      for (const block of msg.content) {
        if (block.text) total += estimateTokens(block.text);
        if (block.input) total += estimateTokens(JSON.stringify(block.input));
        if (block.content) total += estimateTokens(block.content);
      }
    }
    total += 4; // message overhead
  }
  return total;
}
