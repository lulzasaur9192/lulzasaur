import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { getDb } from "../../db/client.js";
import { agents } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { createInboxItem } from "../../inbox/user-inbox.js";

const log = createChildLogger("tool-message-user");

type UserNotifier = (notification: {
  agentId: string;
  agentName: string;
  type: "proposal" | "update" | "question" | "alert";
  message: string;
}) => void;

const notifiers: UserNotifier[] = [];

/** Register a notifier — called by each interface (CLI, web, WhatsApp) at startup. */
export function onUserMessage(fn: UserNotifier): void {
  notifiers.push(fn);
}

/** Unregister a notifier — called when an interface disconnects */
export function offUserMessage(fn: UserNotifier): void {
  const index = notifiers.indexOf(fn);
  if (index !== -1) {
    notifiers.splice(index, 1);
  }
}

registerTool({
  name: "message_user",
  description:
    "Send a message directly to the user. Use this to: " +
    "(1) Propose new work that aligns with your goals, " +
    "(2) Ask for clarification or direction, " +
    "(3) Report important findings or alerts, " +
    "(4) Suggest improvements you've noticed. " +
    "Don't spam — only message when you have something genuinely valuable.",
  capability: "message_user",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["proposal", "update", "question", "alert"],
        description:
          "'proposal' = suggest new work/project, " +
          "'update' = status update on ongoing work, " +
          "'question' = need user input to proceed, " +
          "'alert' = something important the user should know",
      },
      message: {
        type: "string",
        description: "The message to send. Be concise and actionable.",
      },
    },
    required: ["type", "message"],
  },
  execute: async (agentId: string, input: any) => {
    // Look up the agent's actual name from DB
    let agentName = agentId.substring(0, 8);
    try {
      const db = getDb();
      const [agent] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)).limit(1);
      if (agent) agentName = agent.name;
    } catch {
      // Fall back to ID prefix
    }

    // Create inbox item only for actionable types (proposal, question)
    // Updates and alerts are FYI — they show in CLI/Slack via notifiers but don't clutter inbox
    const actionableTypes = ["proposal", "question"];
    if (actionableTypes.includes(input.type)) {
      const titlePrefixes: Record<string, string> = {
        proposal: "Proposal from",
        question: "Question from",
      };
      const titlePrefix = titlePrefixes[input.type] ?? "Message from";
      try {
        await createInboxItem({
          type: input.type,
          agentId,
          agentName,
          title: `${titlePrefix} ${agentName}`,
          body: input.message,
        });
      } catch (e) {
        log.warn({ error: String(e) }, "Failed to create inbox item");
      }
    }

    // Legacy notifier loop (backward compat)
    for (const notify of notifiers) {
      try {
        notify({
          agentId,
          agentName,
          type: input.type,
          message: input.message,
        });
      } catch (e) {
        log.warn({ error: String(e) }, "User notifier failed");
      }
    }

    log.info({ agentId, type: input.type }, "Message sent to user");

    return {
      delivered: true,
      message: "Message delivered to user through all active interfaces.",
    };
  },
});
