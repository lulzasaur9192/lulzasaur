import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, messages } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { resolveTaskId } from "../resolve-task.js";

const log = createChildLogger("tool-approve-plan");

interface ApprovePlanInput {
  epic_id: string;
}

registerTool({
  name: "approve_plan",
  description:
    "Approve a plan epic, activating all its 'planned' child tasks so the dispatcher can assign them to agents. " +
    "Use this when a planner agent submits a plan that looks good and doesn't need user review.",
  capability: "approve_plan",
  inputSchema: {
    type: "object",
    properties: {
      epic_id: {
        type: "string",
        description: "The epic task ID containing the plan to approve",
      },
    },
    required: ["epic_id"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as ApprovePlanInput;

    // Resolve task ID prefix
    try {
      params.epic_id = await resolveTaskId(params.epic_id);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }

    const [epic] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.epic_id))
      .limit(1);

    if (!epic) {
      return { error: `Epic ${params.epic_id} not found` };
    }

    if (epic.type !== "epic") {
      return { error: `Task ${params.epic_id} is not an epic` };
    }

    // Find planned children
    const plannedChildren = await db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.parentTaskId, epic.id), eq(tasks.status, "planned" as any)),
      );

    if (plannedChildren.length === 0) {
      return { error: "No planned tasks found under this epic" };
    }

    // Activate all planned children to pending
    await db
      .update(tasks)
      .set({ status: "pending", updatedAt: new Date() })
      .where(
        and(eq(tasks.parentTaskId, epic.id), eq(tasks.status, "planned" as any)),
      );

    // Set epic to in_progress
    await db
      .update(tasks)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(tasks.id, epic.id));

    // Notify the planner agent if assigned
    if (epic.assignedTo) {
      await db.insert(messages).values({
        type: "task_verification",
        fromAgentId: agentId,
        toAgentId: epic.assignedTo,
        taskId: epic.id,
        content: {
          action: "plan_approved",
          tasks_activated: plannedChildren.length,
          approved_by: agentId,
        },
      });
    }

    // Trigger dispatcher for newly pending tasks
    try {
      const { runDispatchCycle } = await import("../../tasks/task-dispatcher.js");
      await runDispatchCycle(new Map(), (p) => 3);
    } catch {}

    log.info(
      { epicId: epic.id, tasksActivated: plannedChildren.length, approvedBy: agentId },
      "Plan approved",
    );

    return {
      epic_id: epic.id,
      epic_title: epic.title,
      status: "plan_approved",
      tasks_activated: plannedChildren.length,
      task_ids: plannedChildren.map((t) => t.id),
    };
  },
});
