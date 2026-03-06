import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, agents } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { resolveTaskId } from "../resolve-task.js";

const log = createChildLogger("tool-cancel-task");

interface CancelTaskInput {
  task_id: string;
  reason: string;
}

registerTool({
  name: "cancel_task",
  description:
    "Cancel a task that is stuck, orphaned, or no longer needed. " +
    "Sets the task status to 'cancelled'. " +
    "Use this before trash_item to clean up non-terminal tasks.",
  capability: "system_maintenance",
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The task ID (or prefix) to cancel",
      },
      reason: {
        type: "string",
        description: "Why this task is being cancelled (e.g. 'orphaned — assigned agent terminated')",
      },
    },
    required: ["task_id", "reason"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as CancelTaskInput;

    // Resolve task ID prefix to full UUID
    try {
      params.task_id = await resolveTaskId(params.task_id);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.task_id))
      .limit(1);

    if (!task) {
      return { error: `Task ${params.task_id} not found` };
    }

    // Already in a terminal state
    if (["completed", "failed", "cancelled"].includes(task.status)) {
      return {
        task_id: task.id,
        title: task.title,
        status: task.status,
        already_terminal: true,
      };
    }

    await db
      .update(tasks)
      .set({
        status: "cancelled" as any,
        result: {
          cancelled_by: agentId,
          reason: params.reason,
          previous_status: task.status,
        },
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, params.task_id));

    log.info(
      { taskId: params.task_id, previousStatus: task.status, reason: params.reason, cancelledBy: agentId },
      "Task cancelled",
    );

    return {
      task_id: task.id,
      title: task.title,
      previous_status: task.status,
      new_status: "cancelled",
      reason: params.reason,
    };
  },
});
