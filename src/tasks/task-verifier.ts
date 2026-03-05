import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("task-verifier");

/**
 * Verify a completed task. The orchestrator calls this after
 * reviewing a worker's results.
 */
export async function verifyTask(
  taskId: string,
  verified: boolean,
  notes?: string,
): Promise<void> {
  const db = getDb();

  await db
    .update(tasks)
    .set({
      verificationStatus: verified ? "verified" : "rejected",
      verificationNotes: notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  log.info({ taskId, verified, notes }, "Task verification recorded");
}

export async function getUnverifiedTasks(createdBy: string) {
  const db = getDb();
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.createdBy, createdBy));
}
