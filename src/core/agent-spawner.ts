import { createAgent, type CreateAgentOptions } from "./agent-registry.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("agent-spawner");

const MAX_DEPTH = 5;

export interface SpawnOptions {
  name: string;
  soulName: string;
  parentId: string;
  parentDepth: number;
  model?: string;
  provider?: string;
  taskSummary?: string;
  metadata?: Record<string, unknown>;
}

export async function spawnChildAgent(options: SpawnOptions) {
  const childDepth = options.parentDepth + 1;

  if (childDepth > MAX_DEPTH) {
    throw new Error(`Cannot spawn agent at depth ${childDepth} — maximum depth is ${MAX_DEPTH}`);
  }

  const agent = await createAgent({
    name: options.name,
    soulName: options.soulName,
    parentId: options.parentId,
    depth: childDepth,
    model: options.model,
    provider: options.provider,
    metadata: {
      ...options.metadata,
      parentSummary: options.taskSummary ?? `Spawned by agent ${options.parentId}`,
    },
  });

  log.info(
    { agentId: agent.id, name: options.name, depth: childDepth, parent: options.parentId },
    "Child agent spawned",
  );

  return agent;
}
