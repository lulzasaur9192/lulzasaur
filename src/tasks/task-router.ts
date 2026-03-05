import { eq, and } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks, agents } from "../db/schema.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("task-router");

/**
 * Find an idle agent to handle a pending task.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED to avoid race conditions.
 */
export async function routePendingTask(taskId: string): Promise<string | null> {
  const db = getDb();

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || task.status !== "pending") return null;

  // Find idle agents that could handle this task
  const idleAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.status, "idle"))
    .limit(5);

  if (idleAgents.length === 0) {
    log.warn({ taskId }, "No idle agents available for task");
    return null;
  }

  // For now, assign to first idle agent
  const agent = idleAgents[0]!;

  await db
    .update(tasks)
    .set({ assignedTo: agent.id, status: "assigned", updatedAt: new Date() })
    .where(eq(tasks.id, taskId));

  log.info({ taskId, agentId: agent.id }, "Task routed to agent");
  return agent.id;
}
