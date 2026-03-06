import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import {
  systemTrash,
  messages,
  bulletinBoard,
  tasks,
  agents,
} from "../../../db/schema.js";

export const trashRoutes = new Hono();

// List trash items
trashRoutes.get("/", async (c) => {
  const db = getDb();
  const typeFilter = c.req.query("type") as
    | "message"
    | "bulletin_post"
    | "task"
    | undefined;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  let query = db
    .select()
    .from(systemTrash)
    .orderBy(desc(systemTrash.trashedAt))
    .limit(limit);

  if (typeFilter) {
    query = query.where(eq(systemTrash.itemType, typeFilter)) as typeof query;
  }

  const items = await query;

  return c.json(
    items.map((i) => ({
      id: i.id,
      itemType: i.itemType,
      itemId: i.itemId,
      preview: i.preview,
      reason: i.reason,
      trashedByName: i.trashedByName,
      trashedAt: i.trashedAt.toISOString(),
    })),
  );
});

// Restore item from trash
trashRoutes.post("/:id/restore", async (c) => {
  const db = getDb();
  const [trashItem] = await db
    .select()
    .from(systemTrash)
    .where(eq(systemTrash.id, c.req.param("id")))
    .limit(1);

  if (!trashItem) return c.json({ error: "Trash item not found" }, 404);

  const snapshot = trashItem.data as Record<string, unknown>;
  let warning: string | null = null;

  try {
    switch (trashItem.itemType) {
      case "message": {
        await db.insert(messages).values({
          id: snapshot.id as string,
          type: snapshot.type as any,
          fromAgentId: snapshot.fromAgentId as string | null,
          toAgentId: snapshot.toAgentId as string,
          taskId: snapshot.taskId as string | null,
          content: snapshot.content as Record<string, unknown>,
          deliveredAt: snapshot.deliveredAt ? new Date(snapshot.deliveredAt as string) : null,
          readAt: snapshot.readAt ? new Date(snapshot.readAt as string) : null,
          acknowledgedAt: snapshot.acknowledgedAt ? new Date(snapshot.acknowledgedAt as string) : null,
          createdAt: new Date(snapshot.createdAt as string),
        });
        break;
      }

      case "bulletin_post": {
        await db.insert(bulletinBoard).values({
          id: snapshot.id as string,
          authorAgentId: snapshot.authorAgentId as string,
          channel: snapshot.channel as string,
          title: snapshot.title as string,
          body: snapshot.body as string,
          tags: snapshot.tags as string[],
          pinned: snapshot.pinned as boolean,
          projectId: snapshot.projectId as string | null,
          expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt as string) : null,
          createdAt: new Date(snapshot.createdAt as string),
        });
        break;
      }

      case "task": {
        // Check if referenced agents still exist; null out FKs if not
        let assignedTo = snapshot.assignedTo as string | null;
        let createdBy = snapshot.createdBy as string | null;

        if (assignedTo) {
          const [a] = await db.select().from(agents).where(eq(agents.id, assignedTo)).limit(1);
          if (!a) {
            assignedTo = null;
            warning = "assignedTo agent no longer exists; cleared on restore";
          }
        }
        if (createdBy) {
          const [a] = await db.select().from(agents).where(eq(agents.id, createdBy)).limit(1);
          if (!a) {
            createdBy = null;
            warning = (warning ? warning + "; " : "") + "createdBy agent no longer exists; cleared on restore";
          }
        }

        await db.insert(tasks).values({
          id: snapshot.id as string,
          title: snapshot.title as string,
          description: snapshot.description as string,
          status: snapshot.status as any,
          verificationStatus: snapshot.verificationStatus as any,
          createdBy,
          assignedTo,
          parentTaskId: snapshot.parentTaskId as string | null,
          type: snapshot.type as any,
          projectId: snapshot.projectId as string | null,
          input: snapshot.input as Record<string, unknown> | null,
          result: snapshot.result as Record<string, unknown> | null,
          verificationNotes: snapshot.verificationNotes as string | null,
          priority: snapshot.priority as number,
          progressPercent: snapshot.progressPercent as number,
          checkpoint: snapshot.checkpoint as string | null,
          estimatedCompletionAt: snapshot.estimatedCompletionAt
            ? new Date(snapshot.estimatedCompletionAt as string)
            : null,
          metadata: snapshot.metadata as Record<string, unknown>,
          createdAt: new Date(snapshot.createdAt as string),
          updatedAt: new Date(snapshot.updatedAt as string),
          completedAt: snapshot.completedAt
            ? new Date(snapshot.completedAt as string)
            : null,
        });
        break;
      }
    }
  } catch (err) {
    return c.json(
      { error: `Failed to restore: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }

  // Remove from trash
  await db.delete(systemTrash).where(eq(systemTrash.id, trashItem.id));

  return c.json({ restored: true, itemType: trashItem.itemType, ...(warning ? { warning } : {}) });
});

// Permanently delete single item
trashRoutes.delete("/:id", async (c) => {
  const db = getDb();
  const [deleted] = await db
    .delete(systemTrash)
    .where(eq(systemTrash.id, c.req.param("id")))
    .returning();

  if (!deleted) return c.json({ error: "Trash item not found" }, 404);

  return c.json({ deleted: true });
});

// Empty all trash
trashRoutes.delete("/", async (c) => {
  const db = getDb();
  const all = await db.delete(systemTrash).returning();
  return c.json({ deleted: all.length });
});
