import { eq, and, isNull } from "drizzle-orm";
import { getDb, getRawSql } from "../db/client.js";
import { messages } from "../db/schema.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("message-bus");

export interface SendMessageOptions {
  type: "task_assignment" | "task_result" | "task_verification" | "chat" | "system" | "heartbeat_trigger";
  fromAgentId: string | null;
  toAgentId: string;
  content: Record<string, unknown>;
  taskId?: string;
}

export async function sendMessage(options: SendMessageOptions) {
  const db = getDb();

  const [msg] = await db
    .insert(messages)
    .values({
      type: options.type,
      fromAgentId: options.fromAgentId,
      toAgentId: options.toAgentId,
      content: options.content,
      taskId: options.taskId ?? null,
    })
    .returning();

  // Notify via Postgres LISTEN/NOTIFY
  try {
    const sql = getRawSql();
    await sql`SELECT pg_notify('agent_messages', ${JSON.stringify({ agentId: options.toAgentId, messageId: msg!.id })})`;
  } catch (error) {
    log.warn({ error: String(error) }, "NOTIFY failed (non-fatal)");
  }

  log.debug({ messageId: msg!.id, to: options.toAgentId, type: options.type }, "Message sent");
  return msg!;
}

export async function getUnreadMessages(agentId: string) {
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.toAgentId, agentId), isNull(messages.readAt)));
}

export async function markMessageRead(messageId: string) {
  const db = getDb();
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(eq(messages.id, messageId));
}

export async function acknowledgeMessage(messageId: string) {
  const db = getDb();
  await db
    .update(messages)
    .set({ acknowledgedAt: new Date() })
    .where(eq(messages.id, messageId));
}
