import { eq, and, or } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { agents, soulDefinitions, tasks } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { resolveAgentId } from "../resolve-agent.js";

registerTool({
  name: "query_agents",
  description:
    "Query existing agents. Use to find idle agents you can reuse " +
    "instead of spawning new ones. Filter by status, soul name, or parent.",
  capability: "query_agents",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["idle", "active", "sleeping", "terminated"],
        description: "Filter by agent status (default: idle)",
      },
      soul_name: {
        type: "string",
        description: "Filter by soul template name (e.g. 'coder', 'researcher')",
      },
      parent_id: {
        type: "string",
        description: "Filter by parent agent ID",
      },
      include_terminated: {
        type: "boolean",
        description: "Include terminated agents (default: false)",
      },
    },
  },
  execute: async (callerAgentId: string, input: any) => {
    const db = getDb();

    const conditions = [];
    const status = input.status ?? "idle";
    if (!input.include_terminated) {
      conditions.push(eq(agents.status, status as any));
    }
    if (input.parent_id) {
      const parentId = await resolveAgentId(input.parent_id, callerAgentId);
      conditions.push(eq(agents.parentId, parentId));
    }

    let rows;
    if (conditions.length > 0) {
      rows = await db
        .select({ agent: agents, soul: soulDefinitions })
        .from(agents)
        .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
        .where(and(...conditions))
        .limit(50);
    } else {
      rows = await db
        .select({ agent: agents, soul: soulDefinitions })
        .from(agents)
        .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
        .limit(50);
    }

    // Filter by soul name if provided (need to do post-query since it's a join)
    let results = rows;
    if (input.soul_name) {
      results = rows.filter((r) => r.soul?.name === input.soul_name);
    }

    // Fetch active tasks for each agent
    const agentIds = results.map((r) => r.agent.id);
    const activeTasks = agentIds.length > 0
      ? await db
          .select()
          .from(tasks)
          .where(and(
            or(
              eq(tasks.status, "in_progress" as any),
              eq(tasks.status, "assigned" as any),
            ),
          ))
      : [];

    return {
      count: results.length,
      agents: results.map((r) => {
        const agentTask = activeTasks.find((t) => t.assignedTo === r.agent.id);
        return {
          id: r.agent.id,
          name: r.agent.name,
          status: r.agent.status,
          soul: r.soul?.name ?? "unknown",
          intent: r.soul?.intent ?? null,
          depth: r.agent.depth,
          model: r.agent.model,
          parent_id: r.agent.parentId,
          has_heartbeat: !!r.agent.heartbeatIntervalSeconds,
          last_heartbeat_at: r.agent.lastHeartbeatAt?.toISOString() ?? null,
          current_checkpoint: r.agent.currentCheckpoint,
          active_task: agentTask
            ? {
                id: agentTask.id,
                title: agentTask.title,
                status: agentTask.status,
                progress_percent: agentTask.progressPercent,
                checkpoint: agentTask.checkpoint,
              }
            : null,
        };
      }),
    };
  },
});
