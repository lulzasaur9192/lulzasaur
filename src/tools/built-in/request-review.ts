import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, messages } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { resolveTaskId } from "../resolve-task.js";

const log = createChildLogger("tool-request-review");

// Listeners registered by interfaces (CLI, web, Slack) to notify the user
type ReviewNotifier = (review: {
  taskId: string;
  title: string;
  summary: string;
  evidence?: string;
  agentId: string;
}) => void;

const notifiers: ReviewNotifier[] = [];

/** Register a notifier to be called when a review is requested. */
export function onReviewRequested(fn: ReviewNotifier): void {
  notifiers.push(fn);
}

/** Unregister a notifier — called when an interface disconnects */
export function offReviewRequested(fn: ReviewNotifier): void {
  const index = notifiers.indexOf(fn);
  if (index !== -1) {
    notifiers.splice(index, 1);
  }
}

registerTool({
  name: "request_user_review",
  description:
    "Request user review/approval of completed work. Use this INSTEAD of complete_task " +
    "when you believe work is done. The task moves to 'review_pending' and the user is " +
    "notified. The user can approve (task → completed) or reject with feedback " +
    "(task → back to in_progress, you get the feedback on next heartbeat).",
  capability: "request_user_review",
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The task ID to submit for review",
      },
      summary: {
        type: "string",
        description: "Brief summary of what was done",
      },
      evidence: {
        type: "string",
        description: "Evidence the work is complete (test output, build logs, file list, etc.)",
      },
      result: {
        type: "object",
        description: "Structured result data (same as complete_task)",
      },
    },
    required: ["task_id", "summary"],
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    // Resolve task ID prefix to full UUID
    try {
      input.task_id = await resolveTaskId(input.task_id);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }

    // Find the task
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, input.task_id))
      .limit(1);

    if (!task) {
      return { error: `Task ${input.task_id} not found` };
    }

    // Move task to review_pending + reset verification status
    await db
      .update(tasks)
      .set({
        status: "review_pending",
        verificationStatus: "unverified",
        result: input.result ?? { summary: input.summary, evidence: input.evidence },
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, input.task_id));

    // Create a message record for the review request
    // toAgentId = createdBy (the orchestrator/parent who created the task, which represents the user chain)
    const targetAgentId = task.createdBy ?? agentId;
    await db.insert(messages).values({
      type: "task_verification",
      fromAgentId: agentId,
      toAgentId: targetAgentId,
      taskId: input.task_id,
      content: {
        action: "review_requested",
        summary: input.summary,
        evidence: input.evidence ?? null,
      },
    });

    // Notify all registered interfaces (CLI, Slack)
    for (const notify of notifiers) {
      try {
        notify({
          taskId: input.task_id,
          title: task.title,
          summary: input.summary,
          evidence: input.evidence,
          agentId,
        });
      } catch (e) {
        log.warn({ error: String(e) }, "Review notifier failed");
      }
    }

    log.info({ taskId: input.task_id, agentId }, "User review requested");

    return {
      task_id: input.task_id,
      status: "review_pending",
      message: "Review requested. The user will be notified. Await approval or feedback.",
    };
  },
});
