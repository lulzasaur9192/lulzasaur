import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { messages } from "../../../db/schema.js";

export const messageRoutes = new Hono();

// List messages
messageRoutes.get("/", async (c) => {
  const db = getDb();
  const agentId = c.req.query("agent_id");
  let query = db.select().from(messages).orderBy(desc(messages.createdAt)).limit(100);
  if (agentId) {
    query = query.where(eq(messages.toAgentId, agentId)) as any;
  }
  const rows = await query;
  return c.json(rows);
});
