import { eq, and, isNull, desc } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { messages } from "../db/schema.js";

export async function getInbox(agentId: string, options?: { unreadOnly?: boolean; limit?: number }) {
  const db = getDb();
  const conditions = [eq(messages.toAgentId, agentId)];

  if (options?.unreadOnly) {
    conditions.push(isNull(messages.readAt));
  }

  return db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(options?.limit ?? 50);
}

export async function countUnread(agentId: string): Promise<number> {
  const msgs = await getInbox(agentId, { unreadOnly: true });
  return msgs.length;
}
