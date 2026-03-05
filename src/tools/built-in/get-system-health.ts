import { eq, and, ne, or, gte, isNull } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { agents, tasks, soulDefinitions } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";

interface GetSystemHealthInput {
  project_id?: string;
}

registerTool({
  name: "get_system_health",
  description:
    "Get a comprehensive view of system health: all agents with status/checkpoint/heartbeat, " +
    "all active tasks with progress, and blockers (stale agents, stuck tasks, unassigned work). " +
    "Use this instead of reading the bulletin board for status checks.",
  capability: "system_health",
  inputSchema: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Optional: filter to a specific project" },
    },
  },
  execute: async (_agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as GetSystemHealthInput;

    // ── Agents ──
    const agentConditions = [ne(agents.status, "terminated" as any)];
    if (params.project_id) {
      agentConditions.push(eq(agents.projectId, params.project_id));
    }

    const agentRows = await db
      .select({ agent: agents, soul: soulDefinitions })
      .from(agents)
      .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
      .where(and(...agentConditions));

    // ── Active tasks ──
    const taskConditions = [
      or(
        eq(tasks.status, "pending" as any),
        eq(tasks.status, "assigned" as any),
        eq(tasks.status, "in_progress" as any),
        eq(tasks.status, "review_pending" as any),
      )!,
    ];
    if (params.project_id) {
      taskConditions.push(eq(tasks.projectId, params.project_id));
    }

    const activeTasks = await db
      .select()
      .from(tasks)
      .where(and(...taskConditions))
      .limit(100);

    // ── Build agent summaries with active task info ──
    const now = Date.now();
    const agentSummaries = agentRows.map((r) => {
      const a = r.agent;
      const heartbeatInterval = a.heartbeatIntervalSeconds ?? 300;
      const staleThreshold = heartbeatInterval * 3 * 1000; // 3x interval
      const isStale = a.lastHeartbeatAt
        ? (now - new Date(a.lastHeartbeatAt).getTime()) > staleThreshold
        : false;

      const agentTasks = activeTasks
        .filter((t) => t.assignedTo === a.id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          progress_percent: t.progressPercent,
          checkpoint: t.checkpoint,
          estimated_completion_at: t.estimatedCompletionAt?.toISOString() ?? null,
        }));

      return {
        id: a.id,
        name: a.name,
        status: a.status,
        soul: r.soul?.name ?? "unknown",
        current_checkpoint: a.currentCheckpoint,
        last_heartbeat_at: a.lastHeartbeatAt?.toISOString() ?? null,
        next_heartbeat_at: a.nextHeartbeatAt?.toISOString() ?? null,
        is_stale: isStale,
        active_tasks: agentTasks,
      };
    });

    // ── Blockers ──
    const staleAgents = agentSummaries.filter((a) => a.is_stale && a.status === "active");
    const unassignedTasks = activeTasks.filter((t) => !t.assignedTo && t.status === "pending");
    const thirtyMinsAgo = now - 30 * 60 * 1000;
    const stuckTasks = activeTasks.filter(
      (t) =>
        t.status === "in_progress" &&
        t.progressPercent === 0 &&
        new Date(t.updatedAt).getTime() < thirtyMinsAgo,
    );

    // ── Status counts ──
    const agentCounts: Record<string, number> = {};
    for (const a of agentSummaries) {
      agentCounts[a.status] = (agentCounts[a.status] ?? 0) + 1;
    }
    const taskCounts: Record<string, number> = {};
    for (const t of activeTasks) {
      taskCounts[t.status] = (taskCounts[t.status] ?? 0) + 1;
    }

    return {
      agents: agentSummaries,
      tasks: activeTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        progress_percent: t.progressPercent,
        checkpoint: t.checkpoint,
        estimated_completion_at: t.estimatedCompletionAt?.toISOString() ?? null,
        assigned_to: t.assignedTo,
        created_at: t.createdAt,
      })),
      blockers: {
        stale_agents: staleAgents.map((a) => ({ id: a.id, name: a.name, last_heartbeat_at: a.last_heartbeat_at })),
        unassigned_tasks: unassignedTasks.map((t) => ({ id: t.id, title: t.title })),
        stuck_tasks: stuckTasks.map((t) => ({ id: t.id, title: t.title, updated_at: t.updatedAt })),
      },
      counts: {
        agents: agentCounts,
        tasks: taskCounts,
      },
    };
  },
});
