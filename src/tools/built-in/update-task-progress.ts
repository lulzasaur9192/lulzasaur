import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, agents } from "../../db/schema.js";
import { updateTaskProgress } from "../../tasks/task-manager.js";
import { registerTool } from "../tool-registry.js";
import { resolveTaskId } from "../resolve-task.js";

interface UpdateTaskProgressInput {
  task_id: string;
  progress_percent: number;
  checkpoint?: string;
  eta_minutes?: number;
}

registerTool({
  name: "update_task_progress",
  description:
    "Report progress on an active task. Call at meaningful milestones (25%, 50%, 75%). " +
    "Do NOT use bulletin_board for status updates — use this tool instead.",
  capability: "update_task_progress",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task ID to update progress on" },
      progress_percent: { type: "number", description: "Progress percentage (0-100)" },
      checkpoint: { type: "string", description: "Short description of current phase (e.g. 'analyzing data', 'running tests')" },
      eta_minutes: { type: "number", description: "Estimated minutes until completion" },
    },
    required: ["task_id", "progress_percent"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as UpdateTaskProgressInput;

    // Resolve task ID prefix to full UUID
    try {
      params.task_id = await resolveTaskId(params.task_id);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }

    // Validate task is assigned to this agent
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, params.task_id), eq(tasks.assignedTo, agentId)))
      .limit(1);

    if (!task) {
      return { error: `Task ${params.task_id} not found or not assigned to you` };
    }

    const eta = params.eta_minutes
      ? new Date(Date.now() + params.eta_minutes * 60 * 1000)
      : undefined;

    await updateTaskProgress(params.task_id, params.progress_percent, params.checkpoint, eta);

    // Also set agent's currentCheckpoint for visibility
    if (params.checkpoint) {
      await db
        .update(agents)
        .set({ currentCheckpoint: params.checkpoint, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
    }

    return {
      task_id: params.task_id,
      progress_percent: Math.round(Math.max(0, Math.min(100, params.progress_percent))),
      checkpoint: params.checkpoint ?? null,
      estimated_completion_at: eta?.toISOString() ?? null,
    };
  },
});
