import { lte, eq, and, isNotNull, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { agents } from "../db/schema.js";
import { runHeartbeat } from "./heartbeat-runner.js";
import { createChildLogger } from "../utils/logger.js";
import { getConfig } from "../config/index.js";

const log = createChildLogger("scheduler");

let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Track concurrent heartbeats to prevent overload
let activeHeartbeats = 0;
const MAX_CONCURRENT_HEARTBEATS = 2;

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

  log.info({ count: dueAgents.length, active: activeHeartbeats }, "Heartbeats due");

  for (const agent of dueAgents) {
    // Respect concurrency limit to avoid rate-limiting
    if (activeHeartbeats >= MAX_CONCURRENT_HEARTBEATS) {
      log.debug({ agentName: agent.name }, "Deferring heartbeat — concurrency limit reached");
      break;
    }

    activeHeartbeats++;
    try {
      await runHeartbeat(agent);
    } catch (error) {
      log.error({ agentId: agent.id, error: String(error) }, "Heartbeat failed");
    } finally {
      activeHeartbeats--;
    }
  }
}
