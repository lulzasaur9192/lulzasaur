import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { userInbox, tasks, messages, agents } from "../db/schema.js";
import { createChildLogger } from "../utils/logger.js";
import { isSlackConnected, getSlackApp, getSlackBotToken } from "../integrations/slack-ref.js";
import { getProjectChannels, getSystemChannelId, postToChannel } from "../integrations/slack-channels.js";

const log = createChildLogger("user-inbox");

// ── Notifier registry ─────────────────────────────────────────────

export type InboxNotifier = (item: {
  id: string;
  type: string;
  agentId: string;
  agentName: string;
  title: string;
  body: string;
  taskId?: string | null;
  metadata?: Record<string, unknown>;
}) => void;

const notifiers: InboxNotifier[] = [];

export function onInboxItem(fn: InboxNotifier): void {
  notifiers.push(fn);
}

export function offInboxItem(fn: InboxNotifier): void {
  const idx = notifiers.indexOf(fn);
  if (idx !== -1) notifiers.splice(idx, 1);
}

// ── Core functions ────────────────────────────────────────────────

export async function createInboxItem(opts: {
  type: "review" | "proposal" | "question" | "alert" | "update";
  agentId: string;
  agentName: string;
  title: string;
  body: string;
  taskId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();

  const [item] = await db
    .insert(userInbox)
    .values({
      type: opts.type,
      agentId: opts.agentId,
      agentName: opts.agentName,
      title: opts.title,
      body: opts.body,
      taskId: opts.taskId ?? null,
      metadata: opts.metadata ?? {},
    })
    .returning();

  log.info({ id: item!.id, type: opts.type, agent: opts.agentName }, "Inbox item created");

  // Notify all listeners
  for (const notify of notifiers) {
    try {
      notify({
        id: item!.id,
        type: opts.type,
        agentId: opts.agentId,
        agentName: opts.agentName,
        title: opts.title,
        body: opts.body,
        taskId: opts.taskId,
        metadata: opts.metadata,
      });
    } catch (e) {
      log.warn({ error: String(e) }, "Inbox notifier failed");
    }
  }

  // Mirror to Slack if connected
  if (isSlackConnected()) {
    try {
      const slackApp = getSlackApp()!;
      const botToken = getSlackBotToken()!;
      const idPrefix = item!.id.substring(0, 8);

      // Determine target channel: project-specific or system
      let targetChannelId: string | null = null;

      // Look up agent's project
      const [agentRow] = await db
        .select({ projectId: agents.projectId })
        .from(agents)
        .where(eq(agents.id, opts.agentId))
        .limit(1);

      if (agentRow?.projectId) {
        const projectChannels = getProjectChannels(agentRow.projectId);
        if (projectChannels) {
          if (opts.type === "alert" && projectChannels.has("alerts")) {
            targetChannelId = projectChannels.get("alerts")!;
          } else {
            targetChannelId = projectChannels.get("general") ?? null;
          }
        }
      }

      if (!targetChannelId) {
        targetChannelId = getSystemChannelId();
      }

      if (targetChannelId) {
        const typeEmoji: Record<string, string> = {
          review: ":mag:",
          proposal: ":bulb:",
          question: ":question:",
          alert: ":rotating_light:",
          update: ":memo:",
        };
        const emoji = typeEmoji[opts.type] ?? ":inbox_tray:";
        let text = `${emoji} *${opts.title}*\n${opts.body}\n_${opts.agentName} • \`${idPrefix}\`_`;

        if (opts.type === "review") {
          text += `\n\nReply with \`approve ${idPrefix}\` or \`reject ${idPrefix} <feedback>\``;
        } else if (opts.type === "proposal" || opts.type === "question") {
          text += `\n\nReply with \`reply ${idPrefix} <message>\` or \`dismiss ${idPrefix}\``;
        }

        const ts = await postToChannel(slackApp, botToken, targetChannelId, text);

        // Store Slack message timestamp in metadata for threading
        if (ts) {
          await db
            .update(userInbox)
            .set({ metadata: { ...opts.metadata, slackTs: ts, slackChannelId: targetChannelId } })
            .where(eq(userInbox.id, item!.id));
        }
      }
    } catch (e) {
      log.debug({ error: String(e) }, "Failed to mirror inbox item to Slack");
    }
  }

  return item!;
}

export async function getInboxItems(filters?: {
  status?: string;
  type?: string;
  limit?: number;
}) {
  const db = getDb();
  const conditions = [];

  if (filters?.status) {
    conditions.push(eq(userInbox.status, filters.status as any));
  }
  if (filters?.type) {
    conditions.push(eq(userInbox.type, filters.type as any));
  }

  let query = db
    .select()
    .from(userInbox)
    .orderBy(desc(userInbox.createdAt))
    .limit(filters?.limit ?? 50);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return query;
}

export async function getPendingCount(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userInbox)
    .where(eq(userInbox.status, "pending"));
  return row?.count ?? 0;
}

export async function respondToInboxItem(
  itemId: string,
  action: "approve" | "reject" | "dismiss" | "reply",
  message?: string,
) {
  const db = getDb();

  // Fetch item
  const [item] = await db
    .select()
    .from(userInbox)
    .where(eq(userInbox.id, itemId))
    .limit(1);

  if (!item) {
    return { error: "Inbox item not found" };
  }
  if (item.status !== "pending") {
    return { error: `Item already ${item.status}` };
  }

  // Map action → inbox status
  const statusMap: Record<string, "approved" | "rejected" | "dismissed" | "replied"> = {
    approve: "approved",
    reject: "rejected",
    dismiss: "dismissed",
    reply: "replied",
  };

  const newStatus = statusMap[action]!;

  // Update inbox item
  await db
    .update(userInbox)
    .set({
      status: newStatus,
      userResponse: message ?? null,
      respondedAt: new Date(),
    })
    .where(eq(userInbox.id, itemId));

  // Type-specific side effects
  if (item.type === "review" && item.taskId) {
    // Verify the task is still review_pending
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, item.taskId))
      .limit(1);

    if (task && task.status === "review_pending") {
      if (action === "approve") {
        await db
          .update(tasks)
          .set({
            status: "completed",
            verificationStatus: "verified",
            verificationNotes: message || "Approved by user",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, item.taskId));

        if (task.assignedTo) {
          await db.insert(messages).values({
            type: "task_verification",
            toAgentId: task.assignedTo,
            taskId: item.taskId,
            content: { action: "approved", message: message || "User approved your work." },
          });
        }
      } else if (action === "reject") {
        await db
          .update(tasks)
          .set({
            status: "in_progress",
            verificationStatus: "rejected",
            verificationNotes: message || "Rejected — needs changes.",
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, item.taskId));

        if (task.assignedTo) {
          await db.insert(messages).values({
            type: "task_verification",
            toAgentId: task.assignedTo,
            taskId: item.taskId,
            content: { action: "rejected", feedback: message || "Rejected — needs changes." },
          });
        }
      }
    }
  } else if (item.type === "proposal" || item.type === "question") {
    // Send a chat message back to the originating agent
    await db.insert(messages).values({
      type: "chat",
      toAgentId: item.agentId,
      content: {
        source: "user_inbox_response",
        action,
        message: message ?? null,
        originalTitle: item.title,
      },
    });
  }
  // alert/update types: just dismiss, no side effects

  log.info({ itemId, action, type: item.type }, "Inbox item responded");

  return { success: true, action, itemId };
}

/** Dismiss any pending inbox items for a specific taskId (used to avoid stale entries). */
export async function dismissStaleItemsForTask(taskId: string): Promise<void> {
  const db = getDb();
  await db
    .update(userInbox)
    .set({ status: "dismissed", respondedAt: new Date() })
    .where(and(eq(userInbox.taskId, taskId), eq(userInbox.status, "pending")));
}
