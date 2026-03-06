import { eq, and, inArray, desc } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks, agents, soulDefinitions, messages } from "../db/schema.js";
import { assignTask } from "./task-manager.js";
import { spawnChildAgent } from "../agent/spawner.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("task-dispatcher");

// Soul types that reuse persistent agents instead of spawning new ones
const PERSISTENT_SOUL_TYPES = new Set(["researcher", "sysadmin"]);

/**
 * Find tasks in "pending" status whose dependencies are all resolved.
 * A dependency is resolved if its status is completed, failed, cancelled, or the task no longer exists.
 */
export async function findReadyTasks() {
  const db = getDb();

  // Get all pending tasks, sorted by priority desc
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "pending" as any))
    .orderBy(desc(tasks.priority))
    .limit(50);

  if (taskRows.length === 0) return [];

  // Split into no-deps vs has-deps
  const noDeps = taskRows.filter(
    (t) => !t.dependsOn || (t.dependsOn as string[]).length === 0,
  );
  const hasDeps = taskRows.filter(
    (t) => t.dependsOn && (t.dependsOn as string[]).length > 0,
  );

  if (hasDeps.length === 0) return noDeps;

  // Collect all dependency IDs
  const allDepIds = new Set<string>();
  for (const t of hasDeps) {
    for (const depId of t.dependsOn as string[]) {
      allDepIds.add(depId);
    }
  }

  // Batch-fetch dep task statuses
  const depStatuses = new Map<string, string>();
  if (allDepIds.size > 0) {
    const depRows = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, [...allDepIds]));

    for (const row of depRows) {
      depStatuses.set(row.id, row.status);
    }
  }

  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

  // Filter: include task if ALL deps are terminal or missing (deleted = resolved)
  const readyWithDeps = hasDeps.filter((t) => {
    const deps = t.dependsOn as string[];
    const allResolved = deps.every((depId) => {
      const status = depStatuses.get(depId);
      // Missing = deleted = resolved; terminal statuses = resolved
      return !status || TERMINAL_STATUSES.has(status);
    });

    if (!allResolved) {
      // Check for potential circular dependency (all deps are non-terminal and not progressing)
      const nonTerminalDeps = deps.filter((depId) => {
        const status = depStatuses.get(depId);
        return status && !TERMINAL_STATUSES.has(status);
      });
      if (nonTerminalDeps.length === deps.length) {
        const stuckDeps = deps.filter((depId) => {
          const status = depStatuses.get(depId);
          return status === "pending";
        });
        if (stuckDeps.length === deps.length) {
          log.warn(
            { taskId: t.id, deps },
            "Potential circular dependency — all deps are pending",
          );
        }
      }
    }

    return allResolved;
  });

  return [...noDeps, ...readyWithDeps];
}

type TaskRow = Awaited<ReturnType<typeof findReadyTasks>>[number];

/**
 * Dispatch a single ready task to an appropriate agent.
 * Returns the assigned agent ID on success, null on failure.
 */
export async function dispatchTask(
  task: TaskRow,
  activePerProvider: Map<string, number>,
  getProviderLimit: (provider: string) => number,
): Promise<string | null> {
  const db = getDb();
  const soulType = task.suggestedSoul ?? "worker-generic";

  // Already assigned? Skip.
  if (task.assignedTo) return null;

  try {
    // For persistent souls: find an existing idle agent with matching soul
    if (PERSISTENT_SOUL_TYPES.has(soulType)) {
      const idleAgents = await db
        .select({ agent: agents, soul: soulDefinitions })
        .from(agents)
        .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
        .where(
          and(
            eq(soulDefinitions.name, soulType),
            eq(agents.status, "idle"),
          ),
        )
        .limit(1);

      if (idleAgents.length > 0) {
        const agent = idleAgents[0]!.agent;

        // Optimistic locking: only assign if still pending
        const [updated] = await db
          .update(tasks)
          .set({ assignedTo: agent.id, status: "assigned", updatedAt: new Date() })
          .where(and(eq(tasks.id, task.id), eq(tasks.status, "pending" as any)))
          .returning();

        if (!updated) return null; // Someone else grabbed it

        // Wake the agent immediately
        await db
          .update(agents)
          .set({ nextHeartbeatAt: new Date(), updatedAt: new Date() })
          .where(eq(agents.id, agent.id));

        log.info(
          { taskId: task.id, agentId: agent.id, soulType },
          "Dispatched task to existing idle agent",
        );
        return agent.id;
      }
    }

    // For one-shot souls (or no idle persistent agent found): spawn a new agent
    // Check provider concurrency limit
    const provider = "anthropic"; // Default provider for spawned agents
    const active = activePerProvider.get(provider) ?? 0;
    const limit = getProviderLimit(provider);

    if (active >= limit) {
      log.debug(
        { taskId: task.id, provider, active, limit },
        "Deferring dispatch — provider concurrency limit reached",
      );
      return null;
    }

    // Find the orchestrator (task.createdBy's parent) for parentId
    let parentId: string | null = null;
    if (task.createdBy) {
      const [creator] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, task.createdBy))
        .limit(1);
      // Use creator's parent (orchestrator) as the parent, or creator itself
      parentId = creator?.parentId ?? task.createdBy;
    }

    if (!parentId) {
      log.warn({ taskId: task.id }, "No parent agent found for dispatch, skipping");
      return null;
    }

    const [parentAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, parentId))
      .limit(1);

    if (!parentAgent) {
      log.warn({ taskId: task.id, parentId }, "Parent agent not found for dispatch");
      return null;
    }

    const child = await spawnChildAgent({
      name: `${soulType}-${task.id.substring(0, 8)}`,
      soulName: soulType,
      parentId,
      parentDepth: parentAgent.depth,
      taskSummary: task.title,
    });

    // Optimistic locking: assign only if still pending
    const [updated] = await db
      .update(tasks)
      .set({ assignedTo: child.id, status: "assigned", updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, "pending" as any)))
      .returning();

    if (!updated) {
      // Task was grabbed by someone else, terminate the spawned agent
      await db
        .update(agents)
        .set({ status: "terminated", terminatedAt: new Date() })
        .where(eq(agents.id, child.id));
      return null;
    }

    log.info(
      { taskId: task.id, agentId: child.id, soulType },
      "Dispatched task to newly spawned agent",
    );
    return child.id;
  } catch (error) {
    log.error(
      { taskId: task.id, soulType, error: String(error) },
      "Failed to dispatch task",
    );

    // Notify orchestrator of spawn failure
    if (task.createdBy) {
      try {
        // Find the orchestrator (creator's parent)
        const [creator] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, task.createdBy))
          .limit(1);
        const orchestratorId = creator?.parentId ?? task.createdBy;

        await db.insert(messages).values({
          type: "system",
          toAgentId: orchestratorId,
          taskId: task.id,
          content: {
            action: "dispatch_failed",
            task_title: task.title,
            soul_type: soulType,
            error: String(error),
          },
        });
      } catch {
        // Best-effort notification
      }
    }

    return null;
  }
}

/**
 * Run a full dispatch cycle: find ready tasks and dispatch them.
 */
export async function runDispatchCycle(
  activePerProvider: Map<string, number>,
  getProviderLimit: (provider: string) => number,
): Promise<{ dispatched: number; deferred: number }> {
  const readyTasks = await findReadyTasks();

  if (readyTasks.length === 0) {
    return { dispatched: 0, deferred: 0 };
  }

  let dispatched = 0;
  let deferred = 0;

  for (const task of readyTasks) {
    const agentId = await dispatchTask(task, activePerProvider, getProviderLimit);
    if (agentId) {
      dispatched++;
    } else {
      deferred++;
    }
  }

  return { dispatched, deferred };
}
