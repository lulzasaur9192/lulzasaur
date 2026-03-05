import { eq, and, or, ne, isNull, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  agents,
  soulDefinitions,
  conversations,
  messages,
  agentMemory,
  memoryBlocks,
  heartbeatLog,
  bulletinBoard,
  goalEvaluations,
  tasks,
} from "../db/schema.js";
import { createChildLogger } from "../utils/logger.js";
import { AgentError } from "../utils/errors.js";

const log = createChildLogger("agent-registry");

export interface CreateAgentOptions {
  name: string;
  soulName: string;
  parentId?: string;
  depth?: number;
  model?: string;
  provider?: string;
  contextBudget?: number;
  heartbeatIntervalSeconds?: number | null;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

export async function createAgent(options: CreateAgentOptions) {
  const db = getDb();

  // Look up soul — prefer project-scoped match if projectId is given
  const soulConditions = [eq(soulDefinitions.name, options.soulName)];
  if (options.projectId) {
    soulConditions.push(eq(soulDefinitions.projectId, options.projectId));
  } else {
    soulConditions.push(isNull(soulDefinitions.projectId));
  }
  const soul = await db
    .select()
    .from(soulDefinitions)
    .where(and(...soulConditions))
    .limit(1);

  // Fallback: if no project-scoped soul found, try global
  if (soul.length === 0 && options.projectId) {
    const globalSoul = await db
      .select()
      .from(soulDefinitions)
      .where(and(eq(soulDefinitions.name, options.soulName), isNull(soulDefinitions.projectId)))
      .limit(1);
    if (globalSoul.length > 0) soul.push(globalSoul[0]!);
  }

  if (soul.length === 0) {
    throw new AgentError(`Soul "${options.soulName}" not found`, "unknown");
  }
  const soulDef = soul[0]!;

  const [agent] = await db
    .insert(agents)
    .values({
      name: options.name,
      soulId: soulDef.id,
      depth: options.depth ?? 1,
      parentId: options.parentId ?? null,
      model: options.model ?? soulDef.defaultModel,
      provider: options.provider ?? soulDef.defaultProvider ?? "anthropic",
      maxToolIterations: soulDef.maxToolIterations ?? null,
      contextBudget: options.contextBudget ?? soulDef.contextBudget,
      heartbeatIntervalSeconds:
        options.heartbeatIntervalSeconds !== undefined
          ? options.heartbeatIntervalSeconds
          : soulDef.heartbeatIntervalSeconds,
      schedules: soulDef.schedules ?? null,
      // First heartbeat fires immediately so the agent starts working right away.
      // Subsequent heartbeats use the normal interval.
      nextHeartbeatAt:
        (options.heartbeatIntervalSeconds ?? soulDef.heartbeatIntervalSeconds)
          ? new Date()
          : null,
      projectId: options.projectId ?? null,
      metadata: options.metadata ?? {},
    })
    .returning();

  // Create initial conversation
  await db.insert(conversations).values({
    agentId: agent!.id,
    isActive: true,
    messages: [],
    tokenCount: 0,
  });

  // Create default core memory blocks (Letta/MemGPT-style)
  const defaultBlocks = [
    {
      label: "persona",
      description: "Your self-understanding — who you are, your role, your approach to work. Update as you learn about yourself.",
      value: `I am ${options.name}, a ${soulDef.purpose.substring(0, 200)} agent.`,
      charLimit: 2000,
    },
    {
      label: "learned_preferences",
      description: "User and project preferences you've discovered. Coding style, communication preferences, tool choices, naming conventions.",
      value: "",
      charLimit: 2000,
    },
    {
      label: "working_context",
      description: "Your current work state — what you're doing now, what's pending, blockers. Update frequently. This is your scratchpad.",
      value: "",
      charLimit: 3000,
    },
    {
      label: "domain_knowledge",
      description: "Key facts about your domain — architecture decisions, system behavior, important patterns. Distilled from experience.",
      value: "",
      charLimit: 3000,
    },
  ];

  await db.insert(memoryBlocks).values(
    defaultBlocks.map((b) => ({ ...b, agentId: agent!.id })),
  );

  log.info({ agentId: agent!.id, name: options.name, soul: options.soulName }, "Agent created");
  return agent!;
}

export async function getAgent(agentId: string) {
  const db = getDb();
  const results = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  return results[0] ?? null;
}

export async function getAgentWithSoul(agentId: string) {
  const db = getDb();
  const results = await db
    .select({
      agent: agents,
      soul: soulDefinitions,
    })
    .from(agents)
    .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
    .where(eq(agents.id, agentId))
    .limit(1);

  if (results.length === 0) return null;
  return results[0]!;
}

export async function updateAgentStatus(agentId: string, status: "idle" | "active" | "sleeping" | "terminated") {
  const db = getDb();
  await db
    .update(agents)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "terminated" ? { terminatedAt: new Date() } : {}),
      ...(status === "idle" || status === "terminated" ? { currentCheckpoint: null } : {}),
    })
    .where(eq(agents.id, agentId));
}

export async function listAgents(filters?: { status?: string; parentId?: string }) {
  const db = getDb();
  let query = db.select().from(agents);

  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(agents.status, filters.status as any));
  }
  if (filters?.parentId) {
    conditions.push(eq(agents.parentId, filters.parentId));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return query;
}

export async function getActiveConversation(agentId: string) {
  const db = getDb();
  const results = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, agentId), eq(conversations.isActive, true)))
    .limit(1);
  return results[0] ?? null;
}

export async function updateConversation(
  conversationId: string,
  data: { messages?: any[]; tokenCount?: number },
) {
  const db = getDb();
  await db
    .update(conversations)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

/**
 * Delete terminated agents whose soul is NOT persistent (temporary agents).
 * Cascades through all FK references before removing the agent row.
 */
export async function gcTerminatedAgents(): Promise<number> {
  const db = getDb();

  const terminatedTemps = await db
    .select({ id: agents.id })
    .from(agents)
    .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
    .where(
      and(
        eq(agents.status, "terminated"),
        or(eq(soulDefinitions.persistent, false), isNull(soulDefinitions.persistent)),
      ),
    );

  const ids = terminatedTemps.map((r) => r.id);
  if (ids.length === 0) return 0;

  for (const id of ids) {
    // Nullify task references that point to this agent
    await db.update(tasks).set({ assignedTo: null }).where(eq(tasks.assignedTo, id));
    await db.update(tasks).set({ createdBy: null }).where(eq(tasks.createdBy, id));

    // Nullify parent references from child agents
    await db.update(agents).set({ parentId: null }).where(eq(agents.parentId, id));

    // Delete dependent rows
    await db.delete(conversations).where(eq(conversations.agentId, id));
    await db.delete(messages).where(eq(messages.toAgentId, id));
    await db.delete(messages).where(eq(messages.fromAgentId, id));
    await db.delete(agentMemory).where(eq(agentMemory.agentId, id));
    await db.delete(memoryBlocks).where(eq(memoryBlocks.agentId, id));
    await db.delete(heartbeatLog).where(eq(heartbeatLog.agentId, id));
    await db.delete(bulletinBoard).where(eq(bulletinBoard.authorAgentId, id));
    await db.delete(goalEvaluations).where(eq(goalEvaluations.agentId, id));

    // Delete the agent
    await db.delete(agents).where(eq(agents.id, id));
  }

  log.info({ count: ids.length }, "Garbage-collected terminated temporary agents");
  return ids.length;
}

/**
 * Terminate all non-persistent agents that aren't already terminated.
 * Called at boot to clean up stale temporary agents from a previous run.
 */
export async function terminateTemporaryAgents(): Promise<void> {
  const db = getDb();

  const nonPersistentSouls = await db
    .select({ id: soulDefinitions.id })
    .from(soulDefinitions)
    .where(eq(soulDefinitions.persistent, false));

  const soulIds = nonPersistentSouls.map((s) => s.id);
  if (soulIds.length === 0) return;

  const result = await db
    .update(agents)
    .set({ status: "terminated", terminatedAt: new Date() })
    .where(and(inArray(agents.soulId, soulIds), ne(agents.status, "terminated")));

  log.info("Terminated stale temporary agents");
}

/**
 * Sync agent settings (model, intervals, schedules) from their soul definitions.
 * Called at boot to pick up YAML changes without recreating agents.
 */
export async function syncAgentsFromSouls(): Promise<number> {
  const db = getDb();
  let updated = 0;

  const activeAgents = await db
    .select({ agent: agents, soul: soulDefinitions })
    .from(agents)
    .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
    .where(ne(agents.status, "terminated"));

  for (const { agent, soul } of activeAgents) {
    if (!soul) continue;

    const changes: Record<string, unknown> = {};

    // Sync model and provider from soul
    if (soul.defaultModel && agent.model !== soul.defaultModel) {
      changes.model = soul.defaultModel;
    }
    if (soul.defaultProvider && agent.provider !== soul.defaultProvider) {
      changes.provider = soul.defaultProvider;
    }

    // Sync heartbeat interval
    if (soul.heartbeatIntervalSeconds != null && agent.heartbeatIntervalSeconds !== soul.heartbeatIntervalSeconds) {
      changes.heartbeatIntervalSeconds = soul.heartbeatIntervalSeconds;
    }

    // Sync schedules
    const soulSchedules = JSON.stringify(soul.schedules ?? null);
    const agentSchedules = JSON.stringify(agent.schedules ?? null);
    if (soulSchedules !== agentSchedules) {
      changes.schedules = soul.schedules ?? null;
    }

    // Sync context budget
    if (soul.contextBudget != null && agent.contextBudget !== soul.contextBudget) {
      changes.contextBudget = soul.contextBudget;
    }

    // Sync max tool iterations
    if (soul.maxToolIterations != null && agent.maxToolIterations !== soul.maxToolIterations) {
      changes.maxToolIterations = soul.maxToolIterations;
    }

    if (Object.keys(changes).length > 0) {
      await db
        .update(agents)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(agents.id, agent.id));
      log.info({ agentName: agent.name, changes: Object.keys(changes) }, "Synced agent from soul");
      updated++;
    }
  }

  if (updated > 0) {
    log.info({ count: updated }, "Synced agents from soul definitions");
  }
  return updated;
}
