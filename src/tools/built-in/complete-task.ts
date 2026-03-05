import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, agents, soulDefinitions, knowledgeEntities } from "../../db/schema.js";
import { updateAgentStatus } from "../../agent/registry.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-complete-task");

interface CompleteTaskInput {
  task_id: string;
  result: Record<string, unknown>;
  status?: "completed" | "failed";
}

registerTool({
  name: "complete_task",
  description: "Mark a task as completed (or failed) with structured results. Always provide evidence of completion.",
  capability: "complete_task",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task ID to complete" },
      result: { type: "object", description: "Structured result data proving the work is done" },
      status: { type: "string", enum: ["completed", "failed"], description: "Task outcome (default: completed)" },
    },
    required: ["task_id", "result"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as CompleteTaskInput;

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, params.task_id), eq(tasks.assignedTo, agentId)))
      .limit(1);

    if (!task) {
      return { error: `Task ${params.task_id} not found or not assigned to you` };
    }

    const status = params.status ?? "completed";

    await db
      .update(tasks)
      .set({
        status,
        result: params.result,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, params.task_id));

    log.info({ taskId: params.task_id, status, agentId }, "Task completed");

    // ── Auto-save attempt to Knowledge Graph ──
    try {
      const attemptName = `task-${params.task_id}-attempt`;
      const resultSummary = JSON.stringify(params.result).substring(0, 500);
      const attemptContent = `Task: ${task.title}\nStatus: ${status}\nResult: ${resultSummary}`;

      // Auto-detect projectId from agent
      let projectId: string | null = null;
      const [agentForKg] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      if (agentForKg?.projectId) projectId = agentForKg.projectId;

      // Check for existing attempt entity
      const attemptConditions = [
        eq(knowledgeEntities.name, attemptName),
        eq(knowledgeEntities.agentId, agentId),
      ];
      if (projectId) {
        attemptConditions.push(eq(knowledgeEntities.projectId, projectId));
      } else {
        attemptConditions.push(isNull(knowledgeEntities.projectId));
      }

      const [existingAttempt] = await db
        .select()
        .from(knowledgeEntities)
        .where(and(...attemptConditions))
        .limit(1);

      if (existingAttempt) {
        // Append to existing attempt, cap at 2000 chars
        const combined = (existingAttempt.content + "\n---\n" + attemptContent).substring(0, 2000);
        await db
          .update(knowledgeEntities)
          .set({
            content: combined,
            confidence: status === "completed" ? 90 : 60,
            tags: [`task:${params.task_id}`, "task-attempt", status],
            metadata: { taskId: params.task_id, taskTitle: task.title, status, source: "auto-attempt-tracking" },
            updatedAt: new Date(),
          })
          .where(eq(knowledgeEntities.id, existingAttempt.id));
      } else {
        await db.insert(knowledgeEntities).values({
          name: attemptName,
          entityType: "lesson",
          content: attemptContent,
          agentId,
          projectId,
          confidence: status === "completed" ? 90 : 60,
          tags: [`task:${params.task_id}`, "task-attempt", status],
          metadata: { taskId: params.task_id, taskTitle: task.title, status, source: "auto-attempt-tracking" },
        });
      }
    } catch (attemptError) {
      log.warn({ taskId: params.task_id, error: attemptError }, "Failed to save task attempt to KG");
    }

    // Check if this is a one-shot (non-persistent) agent — auto-terminate after task completion
    let autoTerminated = false;
    const [agentRow] = await db
      .select({ agent: agents, soul: soulDefinitions })
      .from(agents)
      .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agentRow && !agentRow.soul?.persistent) {
      // Check if agent has any remaining assigned tasks
      const remainingTasks = await db
        .select()
        .from(tasks)
        .where(and(
          eq(tasks.assignedTo, agentId),
          eq(tasks.status, "in_progress" as any),
        ))
        .limit(1);

      if (remainingTasks.length === 0) {
        await updateAgentStatus(agentId, "terminated");
        autoTerminated = true;
        log.info({ agentId }, "One-shot agent auto-terminated after task completion");
      }
    }

    return {
      task_id: params.task_id,
      status,
      verification_status: "unverified",
      auto_terminated: autoTerminated,
    };
  },
});
