import { lte, eq, and, isNotNull, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { agents } from "../db/schema.js";
import { runHeartbeat } from "./heartbeat.js";
import { createChildLogger } from "../utils/logger.js";
import { getConfig } from "../config/index.js";

const log = createChildLogger("scheduler");

let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Per-provider concurrency tracking
const activePerProvider = new Map<string, number>();
const MAX_CONCURRENT_PER_PROVIDER: Record<string, number> = {
  anthropic: 4,
  huggingface: 4,
};
const DEFAULT_MAX_CONCURRENT = 3;

function getProviderLimit(provider: string): number {
  return MAX_CONCURRENT_PER_PROVIDER[provider] ?? DEFAULT_MAX_CONCURRENT;
}

function getActiveCount(provider: string): number {
  return activePerProvider.get(provider) ?? 0;
}

function incrementActive(provider: string): void {
  activePerProvider.set(provider, getActiveCount(provider) + 1);
}

function decrementActive(provider: string): void {
  const current = getActiveCount(provider);
  activePerProvider.set(provider, Math.max(0, current - 1));
}

/**
 * On first boot, stagger all overdue agents so they don't all fire at once.
 * Spreads them across the next STAGGER_WINDOW_MS.
 */
const STAGGER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
let hasStaggered = false;

export async function staggerOverdueHeartbeats(): Promise<void> {
  if (hasStaggered) return;
  hasStaggered = true;

  const db = getDb();
  const now = new Date();

  const overdueAgents = await db
    .select()
    .from(agents)
    .where(
      and(
        lte(agents.nextHeartbeatAt, now),
        isNotNull(agents.nextHeartbeatAt),
        ne(agents.status, "terminated"),
      ),
    );

  if (overdueAgents.length <= 1) return;

  // Spread agents evenly across the stagger window
  const gap = Math.floor(STAGGER_WINDOW_MS / overdueAgents.length);
  for (let i = 0; i < overdueAgents.length; i++) {
    const staggeredTime = new Date(now.getTime() + gap * i);
    await db
      .update(agents)
      .set({ nextHeartbeatAt: staggeredTime, updatedAt: now })
      .where(eq(agents.id, overdueAgents[i]!.id));
  }

  log.info(
    { count: overdueAgents.length, gapMs: gap },
    "Staggered overdue heartbeats across startup window",
  );
}

export function startScheduler(): void {
  const config = getConfig();
  const pollMs = config.HEARTBEAT_POLL_INTERVAL_SECONDS * 1000;

  log.debug({ pollIntervalMs: pollMs }, "Starting heartbeat scheduler");

  // Stagger on first poll
  staggerOverdueHeartbeats().catch((e) =>
    log.error({ error: String(e) }, "Failed to stagger heartbeats"),
  );

  intervalHandle = setInterval(async () => {
    try {
      await pollHeartbeats();
    } catch (error) {
      log.error({ error: String(error) }, "Heartbeat poll error");
    }
  }, pollMs);
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info("Heartbeat scheduler stopped");
  }
}

async function pollHeartbeats(): Promise<void> {
  const db = getDb();
  const now = new Date();

  // Find agents with overdue heartbeats
  const dueAgents = await db
    .select()
    .from(agents)
    .where(
      and(
        lte(agents.nextHeartbeatAt, now),
        isNotNull(agents.nextHeartbeatAt),
        eq(agents.status, "idle"),
      ),
    );

  if (dueAgents.length === 0) return;

  log.info(
    { count: dueAgents.length, activePerProvider: Object.fromEntries(activePerProvider) },
    "Heartbeats due",
  );

  // Launch heartbeats concurrently (up to per-provider limits)
  const launched: Promise<void>[] = [];

  for (const agent of dueAgents) {
    const provider = agent.provider ?? "unknown";
    const limit = getProviderLimit(provider);
    const active = getActiveCount(provider);

    if (active >= limit) {
      log.debug(
        { agentName: agent.name, provider, active, limit },
        "Deferring heartbeat — provider concurrency limit reached",
      );
      continue; // skip this agent but keep checking others on different providers
    }

    incrementActive(provider);

    const heartbeatPromise = (async () => {
      try {
        await runHeartbeat(agent);
      } catch (error) {
        log.error({ agentId: agent.id, error: String(error) }, "Heartbeat failed");
      } finally {
        decrementActive(provider);
      }
    })();

    launched.push(heartbeatPromise);
  }

  // Wait for all launched heartbeats to complete
  if (launched.length > 0) {
    await Promise.all(launched);
  }

  // Run task dispatcher to assign ready tasks to agents
  try {
    const { runDispatchCycle } = await import("../tasks/task-dispatcher.js");
    const result = await runDispatchCycle(new Map(activePerProvider), getProviderLimit);
    if (result.dispatched > 0) {
      log.info(result, "Dispatch cycle completed");
    }
  } catch (error) {
    log.error({ error: String(error) }, "Dispatch cycle error");
  }
}
