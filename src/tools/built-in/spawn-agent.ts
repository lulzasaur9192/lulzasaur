import { getAgent } from "../../core/agent-registry.js";
import { spawnChildAgent } from "../../core/agent-spawner.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-spawn-agent");

interface SpawnAgentInput {
  name: string;
  soul_name: string;
  model?: string;
  provider?: string;
  task_summary?: string;
}

registerTool({
  name: "spawn_agent",
  description: "Spawn a new child agent. The child receives its soul and task context only — NOT your conversation history.",
  capability: "spawn_agent",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new agent" },
      soul_name: { type: "string", description: "Soul template to use (e.g. 'worker-generic', 'sub-orchestrator')" },
      model: { type: "string", description: "Override LLM model (optional)" },
      provider: { type: "string", description: "Override LLM provider (optional)" },
      task_summary: { type: "string", description: "Brief summary of why this agent is being spawned" },
    },
    required: ["name", "soul_name"],
  },
  execute: async (agentId: string, input: unknown) => {
    const params = input as SpawnAgentInput;

    const parent = await getAgent(agentId);
    if (!parent) {
      return { error: `Parent agent ${agentId} not found` };
    }

    const child = await spawnChildAgent({
      name: params.name,
      soulName: params.soul_name,
      parentId: agentId,
      parentDepth: parent.depth,
      model: params.model,
      provider: params.provider,
      taskSummary: params.task_summary,
    });

    log.info({ parentId: agentId, childId: child.id, name: params.name }, "Agent spawned via tool");

    return {
      agent_id: child.id,
      name: child.name,
      depth: child.depth,
      model: child.model,
    };
  },
});
