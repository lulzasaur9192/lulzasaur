import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  messages,
  bulletinBoard,
  tasks,
  agents,
  systemTrash,
} from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-trash");

// ── trash_item ──────────────────────────────────────────────────────

interface TrashItemInput {
  item_type: "message" | "bulletin_post" | "task";
  item_id: string;
  reason: string;
}

registerTool({
  name: "trash_item",
  description:
    "Move a stale item (message, bulletin post, or task) to the system trash. " +
    "The item is snapshotted and can be restored from the web dashboard. " +
    "Tasks can only be trashed if their status is completed, failed, or cancelled.",
  capability: "system_maintenance",
  inputSchema: {
    type: "object",
    properties: {
      item_type: {
        type: "string",
        enum: ["message", "bulletin_post", "task"],
        description: "Type of item to trash",
      },
      item_id: {
        type: "string",
        description: "UUID of the item to trash",
      },
      reason: {
        type: "string",
        description: "Why this item is being trashed (e.g. 'stale unread message older than 7 days')",
      },
    },
    required: ["item_type", "item_id", "reason"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as TrashItemInput;

    // Look up the requesting agent for trashedByName
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    let data: Record<string, unknown>;
    let preview: string;

    switch (params.item_type) {
      case "message": {
        const [row] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, params.item_id))
          .limit(1);
        if (!row) return { error: `Message ${params.item_id} not found` };

        data = { ...row, createdAt: row.createdAt.toISOString(), deliveredAt: row.deliveredAt?.toISOString() ?? null, readAt: row.readAt?.toISOString() ?? null, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null };
        const contentStr = typeof row.content === "object" ? JSON.stringify(row.content) : String(row.content);
        preview = `Message (${row.type}) to ${row.toAgentId}: ${contentStr.slice(0, 80)}...`;
        break;
      }

      case "bulletin_post": {
        const [row] = await db
          .select()
          .from(bulletinBoard)
          .where(eq(bulletinBoard.id, params.item_id))
          .limit(1);
        if (!row) return { error: `Bulletin post ${params.item_id} not found` };

        data = { ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null };
        preview = `Bulletin [${row.channel}] "${row.title}": ${row.body.slice(0, 80)}...`;
        break;
      }

      case "task": {
        const [row] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, params.item_id))
          .limit(1);
        if (!row) return { error: `Task ${params.item_id} not found` };

        const trashableStatuses = ["completed", "failed", "cancelled"];
        if (!trashableStatuses.includes(row.status)) {
          return {
            error: `Cannot trash task with status '${row.status}'. Only completed, failed, or cancelled tasks can be trashed.`,
          };
        }

        data = { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, estimatedCompletionAt: row.estimatedCompletionAt?.toISOString() ?? null };
        preview = `Task [${row.status}] "${row.title}": ${row.description.slice(0, 80)}...`;
        break;
      }

      default:
        return { error: `Unknown item type: ${params.item_type}` };
    }

    // Insert snapshot into trash
    const [trashRow] = await db
      .insert(systemTrash)
      .values({
        itemType: params.item_type,
        itemId: params.item_id,
        data,
        preview,
        reason: params.reason,
        trashedBy: agentId,
        trashedByName: agent?.name ?? null,
      })
      .returning();

    // Delete original row
    switch (params.item_type) {
      case "message":
        await db.delete(messages).where(eq(messages.id, params.item_id));
        break;
      case "bulletin_post":
        await db.delete(bulletinBoard).where(eq(bulletinBoard.id, params.item_id));
        break;
      case "task":
        await db.delete(tasks).where(eq(tasks.id, params.item_id));
        break;
    }

    log.info(
      { trashId: trashRow!.id, itemType: params.item_type, itemId: params.item_id },
      "Item moved to trash",
    );

    return {
      trashed: true,
      trash_id: trashRow!.id,
      item_type: params.item_type,
      preview,
    };
  },
});

// ── query_trash ─────────────────────────────────────────────────────

interface QueryTrashInput {
  item_type?: "message" | "bulletin_post" | "task";
  limit?: number;
}

registerTool({
  name: "query_trash",
  description:
    "List items currently in the system trash. Optionally filter by item type.",
  capability: "system_maintenance",
  inputSchema: {
    type: "object",
    properties: {
      item_type: {
        type: "string",
        enum: ["message", "bulletin_post", "task"],
        description: "Filter by item type (optional)",
      },
      limit: {
        type: "number",
        description: "Max items to return (default 20)",
      },
    },
  },
  execute: async (_agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as QueryTrashInput;
    const lim = params.limit ?? 20;

    let query = db
      .select()
      .from(systemTrash)
      .orderBy(desc(systemTrash.trashedAt))
      .limit(lim);

    if (params.item_type) {
      query = query.where(eq(systemTrash.itemType, params.item_type)) as typeof query;
    }

    const items = await query;

    return {
      items: items.map((i) => ({
        id: i.id,
        item_type: i.itemType,
        item_id: i.itemId,
        preview: i.preview,
        reason: i.reason,
        trashed_by: i.trashedByName,
        trashed_at: i.trashedAt.toISOString(),
      })),
      count: items.length,
    };
  },
});
