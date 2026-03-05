import { Hono } from "hono";
import { eq, desc, and, or, isNull, gte } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { bulletinBoard, agents } from "../../../db/schema.js";

export const bulletinRoutes = new Hono();

// List bulletin posts
bulletinRoutes.get("/", async (c) => {
  const db = getDb();
  const channel = c.req.query("channel");
  const projectId = c.req.query("projectId");
  const now = new Date();

  const conditions = [
    or(isNull(bulletinBoard.expiresAt), gte(bulletinBoard.expiresAt, now))!,
  ];

  if (channel) {
    conditions.push(eq(bulletinBoard.channel, channel));
  }

  if (projectId) {
    conditions.push(eq(bulletinBoard.projectId, projectId));
  }

  const posts = await db
    .select({
      post: bulletinBoard,
      author: agents,
    })
    .from(bulletinBoard)
    .leftJoin(agents, eq(bulletinBoard.authorAgentId, agents.id))
    .where(and(...conditions))
    .orderBy(desc(bulletinBoard.pinned), desc(bulletinBoard.createdAt))
    .limit(100);

  return c.json(
    posts.map((p) => ({
      id: p.post.id,
      author: p.author?.name ?? "unknown",
      authorId: p.post.authorAgentId,
      channel: p.post.channel,
      title: p.post.title,
      body: p.post.body,
      tags: p.post.tags,
      pinned: p.post.pinned,
      projectId: p.post.projectId,
      createdAt: p.post.createdAt.toISOString(),
    })),
  );
});

// Get single post
bulletinRoutes.get("/:id", async (c) => {
  const db = getDb();
  const [row] = await db
    .select({
      post: bulletinBoard,
      author: agents,
    })
    .from(bulletinBoard)
    .leftJoin(agents, eq(bulletinBoard.authorAgentId, agents.id))
    .where(eq(bulletinBoard.id, c.req.param("id")))
    .limit(1);

  if (!row) return c.json({ error: "Not found" }, 404);

  return c.json({
    id: row.post.id,
    author: row.author?.name ?? "unknown",
    authorId: row.post.authorAgentId,
    channel: row.post.channel,
    title: row.post.title,
    body: row.post.body,
    tags: row.post.tags,
    pinned: row.post.pinned,
    createdAt: row.post.createdAt.toISOString(),
  });
});
