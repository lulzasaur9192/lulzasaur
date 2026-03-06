import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { agents } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { resolveAgentId } from "../resolve-agent.js";

const log = createChildLogger("tool-wake-agent");

registerTool({
  name: "wake_agent",
  description:
    "Immediately wake a sleeping agent by moving its next heartbeat to now. " +
    "This is a one-shot nudge — the agent's normal schedule resumes after it runs.",
  capability: "send_message",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Target agent ID or name" },
      reason: { type: "string", description: "Why you are waking this agent (included in logs)" },
    },
    required: ["agent_id"],
  },
  execute: async (callerAgentId: string, input: unknown) => {
    const db = getDb();
    const params = input as { agent_id: string; reason?: string };

    const targetId = await resolveAgentId(params.agent_id);

    // Fetch current state to give useful feedback
    const [agent] = await db
      .select({ name: agents.name, status: agents.status, nextHeartbeatAt: agents.nextHeartbeatAt })
      .from(agents)
      .where(eq(agents.id, targetId))
      .limit(1);

    if (!agent) {
      return { error: `Agent ${params.agent_id} not found` };
    }

    if (!agent.nextHeartbeatAt) {
      return { error: `Agent "${agent.name}" has no heartbeat configured` };
    }

    const wasScheduledFor = agent.nextHeartbeatAt;
    const now = new Date();

    await db
      .update(agents)
      .set({ nextHeartbeatAt: now, updatedAt: now })
      .where(eq(agents.id, targetId));

    log.info(
      { caller: callerAgentId, target: targetId, targetName: agent.name, reason: params.reason, wasScheduledFor },
      "Agent woken — nextHeartbeatAt set to now",
    );

    return {
      woken: true,
      agent_name: agent.name,
      agent_status: agent.status,
      was_scheduled_for: wasScheduledFor.toISOString(),
      now_scheduled_for: now.toISOString(),
      note: "Agent will be picked up on next scheduler poll. Normal schedule resumes after it runs.",
    };
  },
});
