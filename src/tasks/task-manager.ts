import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { TaskError } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("task-manager");

export interface CreateTaskOptions {
  title: string;
  description: string;
  createdBy: string;
  assignedTo?: string;
  parentTaskId?: string;
  type?: "task" | "epic";
  projectId?: string;
  priority?: number;
  input?: Record<string, unknown>;
}

export async function createTask(options: CreateTaskOptions) {
  const db = getDb();

  const [task] = await db
    .insert(tasks)
    .values({
      title: options.title,
      description: options.description,
      createdBy: options.createdBy,
      assignedTo: options.assignedTo ?? null,
      parentTaskId: options.parentTaskId ?? null,
      type: options.type ?? "task",
      projectId: options.projectId ?? null,
      priority: options.priority ?? 0,
      input: options.input ?? null,
      status: options.assignedTo ? "assigned" : "pending",
    })
    .returning();

  log.info({ taskId: task!.id, title: options.title }, "Task created");
  return task!;
}

export async function assignTask(taskId: string, agentId: string) {
  const db = getDb();

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new TaskError("Task not found", taskId);
  if (task.status !== "pending" && task.status !== "assigned") {
    throw new TaskError(`Cannot assign task in status ${task.status}`, taskId);
  }

  await db
    .update(tasks)
    .set({ assignedTo: agentId, status: "assigned", updatedAt: new Date() })
    .where(eq(tasks.id, taskId));

  log.info({ taskId, agentId }, "Task assigned");
}

export async function updateTaskStatus(
  taskId: string,
  status: "pending" | "assigned" | "in_progress" | "completed" | "failed" | "cancelled",
  result?: Record<string, unknown>,
) {
  const db = getDb();

  await db
    .update(tasks)
    .set({
      status,
      result: result ?? undefined,
      completedAt: ["completed", "failed", "cancelled"].includes(status) ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  log.info({ taskId, status }, "Task status updated");
}

export async function verifyTask(taskId: string, verified: boolean, notes?: string) {
  const db = getDb();

  await db
    .update(tasks)
    .set({
      verificationStatus: verified ? "verified" : "rejected",
      verificationNotes: notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  log.info({ taskId, verified }, "Task verification updated");
}

export async function updateTaskProgress(
  taskId: string,
  progressPercent: number,
  checkpoint?: string,
  estimatedCompletionAt?: Date,
) {
  const db = getDb();
  const clamped = Math.round(Math.max(0, Math.min(100, progressPercent)));

  const updates: Record<string, unknown> = {
    progressPercent: clamped,
    updatedAt: new Date(),
  };
  if (checkpoint !== undefined) updates.checkpoint = checkpoint;
  if (estimatedCompletionAt !== undefined) updates.estimatedCompletionAt = estimatedCompletionAt;

  await db
    .update(tasks)
    .set(updates)
    .where(eq(tasks.id, taskId));

  log.info({ taskId, progressPercent: clamped, checkpoint }, "Task progress updated");
}

export async function getTask(taskId: string) {
  const db = getDb();
  const results = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return results[0] ?? null;
}

export async function listTasks(filters?: {
  status?: string;
  assignedTo?: string;
  createdBy?: string;
  projectId?: string;
  type?: string;
  limit?: number;
}) {
  const db = getDb();
  const conditions = [];

  if (filters?.status) conditions.push(eq(tasks.status, filters.status as any));
  if (filters?.assignedTo) conditions.push(eq(tasks.assignedTo, filters.assignedTo));
  if (filters?.createdBy) conditions.push(eq(tasks.createdBy, filters.createdBy));
  if (filters?.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
  if (filters?.type) conditions.push(eq(tasks.type, filters.type as any));

  let query = db.select().from(tasks);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return (query as any).orderBy(desc(tasks.createdAt)).limit(filters?.limit ?? 50);
}
