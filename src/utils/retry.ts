import { createChildLogger } from "./logger.js";

const log = createChildLogger("retry");

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

const defaults: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export async function withRetry<T>(fn: () => Promise<T>, opts?: Partial<RetryOptions>): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, shouldRetry } = { ...defaults, ...opts };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      if (shouldRetry && !shouldRetry(error)) throw error;

      const delay = Math.min(baseDelayMs * 2 ** attempt + Math.random() * 500, maxDelayMs);
      log.warn({ attempt, delay, error: String(error) }, "Retrying after error");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}
