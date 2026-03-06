import { eq, and, ne, or } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { agents, agentMemory, bulletinBoard, memoryBlocks, tasks } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { stopScheduler } from "../../agent/scheduler.js";
import { closeDb } from "../../db/client.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-graceful-shutdown");

interface GracefulShutdownInput {
  reason: string;
  max_wait_seconds?: number;
}

registerTool({
  name: "graceful_shutdown",
  description:
    "Initiate a graceful system shutdown. Drains active work, saves agent state " +
    "so they can resume after reboot, stops the scheduler, and exits the process. " +
    "Use this when the system needs to be shut down cleanly (maintenance, updates, etc.).",
  capability: "system_shutdown",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why the shutdown is happening (e.g. 'scheduled maintenance', 'system update')",
      },
      max_wait_seconds: {
        type: "number",
        description: "Maximum seconds to wait for active agents to finish (default: 120)",
      },
    },
    required: ["reason"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as GracefulShutdownInput;
    const reason = params.reason;
    const maxWait = params.max_wait_seconds ?? 120;

    log.info({ reason, maxWait, initiatedBy: agentId }, "Graceful shutdown initiated");

    // 1. Post pinned bulletin board announcement
    await db.insert(bulletinBoard).values({
      authorAgentId: agentId,
      channel: "general",
      title: `[SYSTEM] Shutting down: ${reason}`,
      body: `System is shutting down. Reason: ${reason}. All agents should save their current progress.`,
      tags: ["system", "shutdown"],
      pinned: true,
    });

    // 2. Find all non-terminated agents with active tasks and write shutdown checkpoints
    const activeAgents = await db
      .select()
      .from(agents)
      .where(ne(agents.status, "terminated"));

    const activeTaskIds: string[] = [];

    for (const agent of activeAgents) {
      // Find in-progress tasks for this agent
      const inProgressTasks = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.assignedTo, agent.id),
            or(
              eq(tasks.status, "in_progress" as any),
              eq(tasks.status, "assigned" as any),
            ),
          ),
        );

      if (inProgressTasks.length > 0) {
        const taskIds = inProgressTasks.map((t) => t.id);
        activeTaskIds.push(...taskIds);

        // Append shutdown checkpoint to working_context memory block
        const [workingCtx] = await db
          .select()
          .from(memoryBlocks)
          .where(
            and(
              eq(memoryBlocks.agentId, agent.id),
              eq(memoryBlocks.label, "working_context"),
            ),
          )
          .limit(1);

        if (workingCtx) {
          const checkpoint = `\n[SHUTDOWN CHECKPOINT] System is shutting down. Reason: ${reason}. Save your current progress. You will resume this work after restart.`;
          const newValue = workingCtx.value + checkpoint;
          // Only update if within char limit
          if (newValue.length <= workingCtx.charLimit) {
            await db
              .update(memoryBlocks)
              .set({ value: newValue, updatedAt: new Date() })
              .where(eq(memoryBlocks.id, workingCtx.id));
          }
        }
      }

      // Write KV memory entry for heartbeat resume detection
      const checkpointValue = {
        reason,
        timestamp: new Date().toISOString(),
        active_task_ids: inProgressTasks.map((t) => t.id),
      };

      // Upsert shutdown_checkpoint
      const [existing] = await db
        .select()
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.agentId, agent.id),
            eq(agentMemory.namespace, "system"),
            eq(agentMemory.key, "shutdown_checkpoint"),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(agentMemory)
          .set({ value: checkpointValue, updatedAt: new Date() })
          .where(eq(agentMemory.id, existing.id));
      } else {
        await db.insert(agentMemory).values({
          agentId: agent.id,
          namespace: "system",
          key: "shutdown_checkpoint",
          value: checkpointValue,
        });
      }
    }

    // 3. Stop the scheduler — no new heartbeats
    stopScheduler();
    log.info("Scheduler stopped");

    // Count active agents before drain
    const activeCount = activeAgents.filter((a) => a.status === "active").length;

    // Return immediately so the orchestrator gets a response
    const result = {
      status: "shutdown_initiated",
      reason,
      active_agents: activeCount,
      checkpointed_tasks: activeTaskIds.length,
    };

    // 4-7. Drain, force idle, terminate, and exit in the background
    setImmediate(async () => {
      try {
        // 4. Poll for active agents to finish, up to max_wait_seconds
        const deadline = Date.now() + maxWait * 1000;
        while (Date.now() < deadline) {
          const stillActive = await db
            .select()
            .from(agents)
            .where(eq(agents.status, "active" as any));
          if (stillActive.length === 0) break;
          log.info({ remaining: stillActive.length }, "Waiting for active agents to finish");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        // 5. Force any still-active agents to idle
        await db
          .update(agents)
          .set({ status: "idle", currentCheckpoint: null, updatedAt: new Date() })
          .where(eq(agents.status, "active" as any));

        // 6. Mark all non-terminated agents as terminated
        await db
          .update(agents)
          .set({ status: "terminated", terminatedAt: new Date(), updatedAt: new Date() })
          .where(ne(agents.status, "terminated"));

        log.info("All agents terminated, closing database");

        // 7. Close DB and exit
        await closeDb();
        process.exit(0);
      } catch (error) {
        log.error({ error: String(error) }, "Error during shutdown drain");
        process.exit(1);
      }
    });

    return result;
  },
});
