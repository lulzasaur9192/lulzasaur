import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { desc, gte, eq, and, isNotNull, ne, sql, or } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { heartbeatLog, agents, tasks, tokenUsageLog } from "../../../db/schema.js";
import { claudeCodeStream, type ClaudeCodeStreamEvent } from "../../../integrations/claude-code-stream.js";
import { getActiveScheduleInterval } from "../../../agent/schedule-matcher.js";

export const activityRoutes = new Hono();

// Get heartbeat logs (with agent names)
activityRoutes.get("/heartbeats", async (c) => {
  const db = getDb();
  const rows = await db
    .select({
      id: heartbeatLog.id,
      agentId: heartbeatLog.agentId,
      agentName: agents.name,
      triggeredAt: heartbeatLog.triggeredAt,
      completedAt: heartbeatLog.completedAt,
      durationMs: heartbeatLog.durationMs,
      result: heartbeatLog.result,
      error: heartbeatLog.error,
    })
    .from(heartbeatLog)
    .leftJoin(agents, eq(heartbeatLog.agentId, agents.id))
    .orderBy(desc(heartbeatLog.triggeredAt))
    .limit(50);
  return c.json(rows);
});

// Projected heartbeat schedule — 7 days, hourly resolution
activityRoutes.get("/schedule", async (c) => {
  const db = getDb();

  // Get active/idle agents that have heartbeats configured (skip terminated)
  const allAgents = await db
    .select()
    .from(agents)
    .where(and(isNotNull(agents.nextHeartbeatAt), ne(agents.status, "terminated")));

  const now = new Date();
  // Start of the current day (midnight)
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // 7 days × 24 hours = 168 hourly slots
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const agentSchedules = allAgents.map((agent) => {
    // For each hour of 7 days, compute the interval and wakeups/hour
    const hourly: { day: number; dayLabel: string; hour: number; wakeupsPerHour: number; intervalSeconds: number; scheduleName: string | null }[] = [];

    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(startOfToday);
      dayDate.setDate(dayDate.getDate() + d);

      for (let h = 0; h < 24; h++) {
        const slotTime = new Date(dayDate);
        slotTime.setHours(h, 30, 0, 0); // sample mid-hour

        const { interval, scheduleName } = getActiveScheduleInterval(
          agent.schedules,
          agent.heartbeatIntervalSeconds ?? 300,
          slotTime,
        );

        const wakeupsPerHour = interval > 0 ? 3600 / interval : 0;

        hourly.push({
          day: d,
          dayLabel: days[slotTime.getDay()]!,
          hour: h,
          wakeupsPerHour: Math.round(wakeupsPerHour * 10) / 10,
          intervalSeconds: interval,
          scheduleName,
        });
      }
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      status: agent.status,
      projectId: agent.projectId,
      nextHeartbeatAt: agent.nextHeartbeatAt,
      defaultInterval: agent.heartbeatIntervalSeconds,
      hourly,
    };
  });

  // Also return day labels with dates for the header
  const dayHeaders = [];
  for (let d = 0; d < 7; d++) {
    const dayDate = new Date(startOfToday);
    dayDate.setDate(dayDate.getDate() + d);
    dayHeaders.push({
      day: d,
      dayLabel: days[dayDate.getDay()]!,
      date: dayDate.toISOString().split("T")[0],
      isToday: d === 0,
    });
  }

  return c.json({ dayHeaders, agents: agentSchedules });
});

// Token usage — recent log entries
activityRoutes.get("/tokens", async (c) => {
  const db = getDb();
  const hours = parseInt(c.req.query("hours") ?? "24");
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(tokenUsageLog)
    .where(gte(tokenUsageLog.createdAt, since))
    .orderBy(desc(tokenUsageLog.createdAt))
    .limit(500);

  return c.json(rows);
});

// Token usage — summary by agent
activityRoutes.get("/tokens/summary", async (c) => {
  const db = getDb();
  const hours = parseInt(c.req.query("hours") ?? "24");
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await db
    .select({
      agentName: tokenUsageLog.agentName,
      model: tokenUsageLog.model,
      trigger: tokenUsageLog.trigger,
      calls: sql<number>`count(*)::int`,
      totalInput: sql<number>`sum(${tokenUsageLog.inputTokens})::int`,
      totalOutput: sql<number>`sum(${tokenUsageLog.outputTokens})::int`,
      totalTokens: sql<number>`sum(${tokenUsageLog.totalTokens})::int`,
      avgDurationMs: sql<number>`avg(${tokenUsageLog.durationMs})::int`,
    })
    .from(tokenUsageLog)
    .where(gte(tokenUsageLog.createdAt, since))
    .groupBy(tokenUsageLog.agentName, tokenUsageLog.model, tokenUsageLog.trigger)
    .orderBy(sql`sum(${tokenUsageLog.totalTokens}) desc`);

  // Also compute grand total
  const [totals] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      totalInput: sql<number>`sum(${tokenUsageLog.inputTokens})::int`,
      totalOutput: sql<number>`sum(${tokenUsageLog.outputTokens})::int`,
      totalTokens: sql<number>`sum(${tokenUsageLog.totalTokens})::int`,
    })
    .from(tokenUsageLog)
    .where(gte(tokenUsageLog.createdAt, since));

  // Estimate cost (rough: sonnet=$3/$15, haiku=$0.80/$4 per MTok)
  const costEstimate = rows.reduce((sum, r) => {
    const isHaiku = r.model.includes("haiku");
    const inputRate = isHaiku ? 0.80 : 3.0;  // $/MTok
    const outputRate = isHaiku ? 4.0 : 15.0;
    return sum + (r.totalInput * inputRate + r.totalOutput * outputRate) / 1_000_000;
  }, 0);

  return c.json({
    period: `${hours}h`,
    since: since.toISOString(),
    totals: { ...totals, estimatedCostUSD: Math.round(costEstimate * 100) / 100 },
    byAgent: rows,
  });
});

// Token usage — hourly breakdown for chart
activityRoutes.get("/tokens/hourly", async (c) => {
  const db = getDb();
  const hours = parseInt(c.req.query("hours") ?? "24");
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await db
    .select({
      hour: sql<string>`to_char(${tokenUsageLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:00')`,
      totalTokens: sql<number>`sum(${tokenUsageLog.totalTokens})::int`,
      inputTokens: sql<number>`sum(${tokenUsageLog.inputTokens})::int`,
      outputTokens: sql<number>`sum(${tokenUsageLog.outputTokens})::int`,
      calls: sql<number>`count(*)::int`,
    })
    .from(tokenUsageLog)
    .where(gte(tokenUsageLog.createdAt, since))
    .groupBy(sql`to_char(${tokenUsageLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:00')`)
    .orderBy(sql`to_char(${tokenUsageLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:00')`);

  return c.json(rows);
});

// SSE activity stream
activityRoutes.get("/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    let lastCheck = new Date();

    // Forward Claude Code stream events directly to this SSE client
    const forwardClaudeCode = (event: ClaudeCodeStreamEvent) => {
      stream.writeSSE({
        event: "claude_code_output",
        data: JSON.stringify(event),
      }).catch(() => { /* client disconnected */ });
    };
    claudeCodeStream.onStream(forwardClaudeCode);

    // Clean up listener when client disconnects
    stream.onAbort(() => {
      claudeCodeStream.offStream(forwardClaudeCode);
    });

    while (true) {
      const db = getDb();

      // Check for recent agent activity
      const recentAgents = await db
        .select()
        .from(agents)
        .orderBy(desc(agents.updatedAt))
        .limit(5);

      const recentTasks = await db
        .select()
        .from(tasks)
        .orderBy(desc(tasks.updatedAt))
        .limit(5);

      for (const agent of recentAgents) {
        if (agent.updatedAt > lastCheck) {
          await stream.writeSSE({
            event: "agent_update",
            data: JSON.stringify({ id: agent.id, name: agent.name, status: agent.status }),
          });
        }
      }

      for (const task of recentTasks) {
        if (task.updatedAt > lastCheck) {
          await stream.writeSSE({
            event: "task_update",
            data: JSON.stringify({
              id: task.id,
              title: task.title,
              status: task.status,
              progress_percent: task.progressPercent,
              checkpoint: task.checkpoint,
            }),
          });
        }
      }

      // System health summary
      const allAgents = await db
        .select()
        .from(agents)
        .where(ne(agents.status, "terminated" as any));
      const activeTasks = await db
        .select()
        .from(tasks)
        .where(
          or(
            eq(tasks.status, "planned" as any),
            eq(tasks.status, "pending" as any),
            eq(tasks.status, "assigned" as any),
            eq(tasks.status, "in_progress" as any),
            eq(tasks.status, "review_pending" as any),
          ),
        );

      const agentCounts: Record<string, number> = {};
      for (const a of allAgents) {
        agentCounts[a.status] = (agentCounts[a.status] ?? 0) + 1;
      }
      const taskCounts: Record<string, number> = {};
      for (const t of activeTasks) {
        taskCounts[t.status] = (taskCounts[t.status] ?? 0) + 1;
      }

      await stream.writeSSE({
        event: "system_health",
        data: JSON.stringify({
          agents: agentCounts,
          tasks: taskCounts,
          total_agents: allAgents.length,
          total_active_tasks: activeTasks.length,
        }),
      });

      lastCheck = new Date();
      await stream.sleep(2000);
    }
  });
});
