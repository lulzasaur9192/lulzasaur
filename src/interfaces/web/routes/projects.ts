import { Hono } from "hono";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { projects, agents, tasks, soulDefinitions } from "../../../db/schema.js";

export const projectRoutes = new Hono();

// List all projects (only active by default)
projectRoutes.get("/", async (c) => {
  const db = getDb();
  const includeInactive = c.req.query("include_inactive") === "true";
  let query = db.select().from(projects).orderBy(desc(projects.createdAt));
  if (!includeInactive) {
    query = query.where(eq(projects.active, true)) as any;
  }
  const rows = await query;
  return c.json(rows);
});

// Get single project with agent/task counts
projectRoutes.get("/:id", async (c) => {
  const db = getDb();
  const projectId = c.req.param("id");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return c.json({ error: "Not found" }, 404);

  const agentRows = await db.select().from(agents).where(eq(agents.projectId, projectId));
  const taskRows = await db.select().from(tasks).where(eq(tasks.projectId, projectId));
  const epicRows = taskRows.filter((t) => t.type === "epic");

  return c.json({
    ...project,
    agentCount: agentRows.length,
    taskCount: taskRows.length,
    epicCount: epicRows.length,
  });
});

// List project's agents
projectRoutes.get("/:id/agents", async (c) => {
  const db = getDb();
  const projectId = c.req.param("id");
  const rows = await db
    .select({ agent: agents, soul: soulDefinitions })
    .from(agents)
    .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
    .where(eq(agents.projectId, projectId));
  return c.json(rows);
});

// List project's epics with nested child tasks
projectRoutes.get("/:id/epics", async (c) => {
  const db = getDb();
  const projectId = c.req.param("id");

  // Get all epics for this project
  const epics = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.type, "epic" as any)))
    .orderBy(desc(tasks.createdAt));

  // Get all child tasks for these epics
  const epicIds = epics.map((e) => e.id);
  let childTasks: (typeof tasks.$inferSelect)[] = [];
  if (epicIds.length > 0) {
    childTasks = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.parentTaskId, epicIds));
  }

  // Assemble epic + children
  const result = epics.map((epic) => {
    const children = childTasks.filter((t) => t.parentTaskId === epic.id);
    const completedCount = children.filter((t) => t.status === "completed").length;
    return {
      ...epic,
      children,
      progress: children.length > 0 ? Math.round((completedCount / children.length) * 100) : 0,
    };
  });

  return c.json(result);
});
