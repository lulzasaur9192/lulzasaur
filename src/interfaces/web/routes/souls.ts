import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { soulDefinitions, goalEvaluations } from "../../../db/schema.js";
import { cloneSoul } from "../../../core/soul.js";

export const soulRoutes = new Hono();

// List all souls
soulRoutes.get("/", async (c) => {
  const db = getDb();
  const rows = await db.select().from(soulDefinitions);
  return c.json(rows);
});

// Get single soul
soulRoutes.get("/:name", async (c) => {
  const db = getDb();
  const [row] = await db
    .select()
    .from(soulDefinitions)
    .where(eq(soulDefinitions.name, c.req.param("name")))
    .limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// Clone a soul
soulRoutes.post("/:name/clone", async (c) => {
  const { newName, ...overrides } = await c.req.json();
  if (!newName) return c.json({ error: "newName is required" }, 400);
  const cloned = await cloneSoul(c.req.param("name"), newName, overrides);
  return c.json(cloned, 201);
});

// Goal evaluations for a soul's agents
soulRoutes.get("/:name/goals", async (c) => {
  const db = getDb();
  const rows = await db.select().from(goalEvaluations).limit(50);
  return c.json(rows);
});
