import { Hono } from "hono";
import { eq, desc, and } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { tasks, messages } from "../../../db/schema.js";

export const taskRoutes = new Hono();

// List tasks
taskRoutes.get("/", async (c) => {
  const db = getDb();
  const status = c.req.query("status");
  const projectId = c.req.query("projectId");
  const type = c.req.query("type");
  const conditions = [];
  if (status) conditions.push(eq(tasks.status, status as any));
  if (projectId) conditions.push(eq(tasks.projectId, projectId));
  if (type) conditions.push(eq(tasks.type, type as any));

  let query = db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(100);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  const rows = await query;
  return c.json(rows);
});

// Get single task
taskRoutes.get("/:id", async (c) => {
  const db = getDb();
  const [row] = await db.select().from(tasks).where(eq(tasks.id, c.req.param("id"))).limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// Update a task (user edits from dashboard)
taskRoutes.patch("/:id", async (c) => {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, c.req.param("id"))).limit(1);
  if (!task) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.assignedTo !== undefined) updates.assignedTo = body.assignedTo || null;
  if (body.status !== undefined) {
    updates.status = body.status;
    if (["completed", "failed", "cancelled"].includes(body.status)) {
      updates.completedAt = new Date();
    }
  }

  await db.update(tasks).set(updates).where(eq(tasks.id, task.id));

  // Notify assigned agent if status changed
  if (body.status && body.status !== task.status && task.assignedTo) {
    await db.insert(messages).values({
      type: "system",
      toAgentId: task.assignedTo,
      taskId: task.id,
      content: { action: "task_updated", newStatus: body.status, message: `Task status changed to ${body.status} by user.` },
    });
  }

  const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1);
  return c.json(updated);
});

// Approve a task (user review) or approve a plan (epic with planned children)
taskRoutes.post("/:id/approve", async (c) => {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, c.req.param("id"))).limit(1);
  if (!task) return c.json({ error: "Not found" }, 404);

  // Check if this is a plan epic with planned children
  const plannedChildren = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, task.id), eq(tasks.status, "planned" as any)));

  if (plannedChildren.length > 0) {
    // Plan approval: activate children, set epic to in_progress
    await db
      .update(tasks)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(tasks.parentTaskId, task.id), eq(tasks.status, "planned" as any)));
    await db
      .update(tasks)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(tasks.id, task.id));

    // Notify planner/orchestrator
    if (task.assignedTo) {
      await db.insert(messages).values({
        type: "task_verification",
        toAgentId: task.assignedTo,
        taskId: task.id,
        content: { action: "plan_approved", tasks_activated: plannedChildren.length },
      });
    }

    // Trigger dispatcher
    try {
      const { runDispatchCycle } = await import("../../../tasks/task-dispatcher.js");
      await runDispatchCycle(new Map(), (p) => 3);
    } catch {}

    return c.json({ status: "plan_approved", tasks_activated: plannedChildren.length });
  }

  // Standard review approval
  if (task.status !== "review_pending") return c.json({ error: "Task not pending review" }, 400);

  await db.update(tasks).set({
    status: "completed",
    verificationStatus: "verified",
    verificationNotes: "Approved by user",
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(tasks.id, task.id));

  if (task.assignedTo) {
    await db.insert(messages).values({
      type: "task_verification",
      toAgentId: task.assignedTo,
      taskId: task.id,
      content: { action: "approved", message: "User approved your work." },
    });
  }

  return c.json({ status: "approved", task_id: task.id });
});

// Reject a task with feedback (user review)
taskRoutes.post("/:id/reject", async (c) => {
  const db = getDb();
  const { feedback } = await c.req.json();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, c.req.param("id"))).limit(1);
  if (!task) return c.json({ error: "Not found" }, 404);
  if (task.status !== "review_pending") return c.json({ error: "Task not pending review" }, 400);

  await db.update(tasks).set({
    status: "in_progress",
    verificationStatus: "rejected",
    verificationNotes: feedback ?? "Rejected — needs changes.",
    updatedAt: new Date(),
  }).where(eq(tasks.id, task.id));

  if (task.assignedTo) {
    await db.insert(messages).values({
      type: "task_verification",
      toAgentId: task.assignedTo,
      taskId: task.id,
      content: { action: "rejected", feedback: feedback ?? "Rejected — needs changes." },
    });
  }

  return c.json({ status: "rejected", task_id: task.id, feedback });
});
