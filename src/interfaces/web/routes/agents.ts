import { Hono } from "hono";
import { eq, ne, and, desc } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { agents, soulDefinitions, conversations, agentMemory, heartbeatLog } from "../../../db/schema.js";
import { createAgent } from "../../../agent/registry.js";
import { runAgentTurn } from "../../../agent/runtime.js";

export const agentRoutes = new Hono();

// List agents (defaults to hiding terminated; use ?include_terminated=true to show all)
agentRoutes.get("/", async (c) => {
  const db = getDb();
  const includeTerminated = c.req.query("include_terminated") === "true";
  const statusFilter = c.req.query("status");

  let query = db
    .select({ agent: agents, soul: soulDefinitions })
    .from(agents)
    .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id));

  if (statusFilter) {
    query = query.where(eq(agents.status, statusFilter as any)) as any;
  } else if (!includeTerminated) {
    query = query.where(ne(agents.status, "terminated" as any)) as any;
  }

  const rows = await query;
  return c.json(rows);
});

// Get single agent
agentRoutes.get("/:id", async (c) => {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.id, c.req.param("id"))).limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// Create agent
agentRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const agent = await createAgent(body);
  return c.json(agent, 201);
});

// Update agent
agentRoutes.patch("/:id", async (c) => {
  const db = getDb();
  const body = await c.req.json();
  await db.update(agents).set({ ...body, updatedAt: new Date() }).where(eq(agents.id, c.req.param("id")));
  const [updated] = await db.select().from(agents).where(eq(agents.id, c.req.param("id"))).limit(1);
  return c.json(updated);
});

// Get agent conversations
agentRoutes.get("/:id/conversations", async (c) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.agentId, c.req.param("id")));
  return c.json(rows);
});

// Get agent's Claude Code session status from memory
agentRoutes.get("/:id/claude-code-status", async (c) => {
  const db = getDb();
  const result = await db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.agentId, c.req.param("id")),
        eq(agentMemory.namespace, "claude_code"),
        eq(agentMemory.key, "current_session_status"),
      ),
    )
    .limit(1);

  if (result.length === 0) {
    return c.json({ status: null });
  }
  return c.json({ status: result[0]!.value, updatedAt: result[0]!.updatedAt });
});

// Get agent heartbeats (last 20)
agentRoutes.get("/:id/heartbeats", async (c) => {
  const db = getDb();
  const rows = await db
    .select({
      id: heartbeatLog.id,
      agentId: heartbeatLog.agentId,
      triggeredAt: heartbeatLog.triggeredAt,
      completedAt: heartbeatLog.completedAt,
      durationMs: heartbeatLog.durationMs,
      result: heartbeatLog.result,
      error: heartbeatLog.error,
    })
    .from(heartbeatLog)
    .where(eq(heartbeatLog.agentId, c.req.param("id")))
    .orderBy(desc(heartbeatLog.triggeredAt))
    .limit(20);
  return c.json(rows);
});

// Send message to agent (chat)
agentRoutes.post("/:id/message", async (c) => {
  const { text } = await c.req.json();
  const result = await runAgentTurn(c.req.param("id"), text);
  return c.json({
    response: result.response,
    toolCalls: result.toolCalls.length,
    tokens: result.tokenUsage.totalTokens,
    durationMs: result.durationMs,
  });
});
