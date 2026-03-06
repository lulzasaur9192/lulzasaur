import { getDb } from "../../db/client.js";
import { messages } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { resolveAgentId } from "../resolve-agent.js";
import { resolveTaskId } from "../resolve-task.js";

const log = createChildLogger("tool-send-message");

interface SendMessageInput {
  to_agent_id: string;
  type: "task_assignment" | "task_result" | "task_verification" | "chat" | "system";
  content: Record<string, unknown>;
  task_id?: string;
}

registerTool({
  name: "send_message",
  description: "Send a typed message to another agent. Messages are stored durably and delivered on next agent turn.",
  capability: "send_message",
  inputSchema: {
    type: "object",
    properties: {
      to_agent_id: { type: "string", description: "Recipient agent ID or name" },
      type: {
        type: "string",
        enum: ["task_assignment", "task_result", "task_verification", "chat", "system"],
        description: "Message type",
      },
      content: { type: "object", description: "Message content (structured)" },
      task_id: { type: "string", description: "Related task ID (optional)" },
    },
    required: ["to_agent_id", "type", "content"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as SendMessageInput;

    // Resolve name/prefix to full UUID
    const recipientId = await resolveAgentId(params.to_agent_id);

    // Resolve task ID prefix to full UUID if provided
    let taskId: string | null = null;
    if (params.task_id) {
      try {
        taskId = await resolveTaskId(params.task_id);
      } catch {
        // Non-critical — send message without task link
        taskId = null;
      }
    }

    const [msg] = await db
      .insert(messages)
      .values({
        type: params.type,
        fromAgentId: agentId,
        toAgentId: recipientId,
        taskId,
        content: params.content,
      })
      .returning();

    log.info({ messageId: msg!.id, from: agentId, to: recipientId, type: params.type }, "Message sent");

    return {
      message_id: msg!.id,
      delivered: false,
      note: "Message will be delivered on recipient's next turn",
    };
  },
});
