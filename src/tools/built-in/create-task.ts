import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, agents } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { resolveAgentId } from "../resolve-agent.js";

const log = createChildLogger("tool-create-task");

interface CreateTaskInput {
  title: string;
  description: string;
  assign_to?: string;
  priority?: number;
  parent_task_id?: string;
  type?: "task" | "epic";
  project_id?: string;
  input?: Record<string, unknown>;
}

registerTool({
  name: "create_task",
  description: "Create a new task or epic in the task system. Tasks are durable work units tracked in the database. Epics are high-level containers that group related tasks.",
  capability: "create_task",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short task title" },
      description: { type: "string", description: "Detailed task description" },
      assign_to: { type: "string", description: "Agent ID to assign the task to (optional)" },
      priority: { type: "number", description: "Priority (0=normal, higher=more urgent)" },
      parent_task_id: { type: "string", description: "Parent task ID if this is a sub-task" },
      type: { type: "string", enum: ["task", "epic"], description: "Type: 'task' (default) or 'epic' (container for related tasks)" },
      project_id: { type: "string", description: "Project ID to scope this task to (auto-detected from agent if not specified)" },
      input: { type: "object", description: "Structured input data for the task" },
    },
    required: ["title", "description"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as CreateTaskInput;

    // Auto-detect projectId from the creating agent if not specified
    let projectId = params.project_id ?? null;
    if (!projectId) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      if (agent?.projectId) projectId = agent.projectId;
    }

    // Resolve assign_to name to UUID if provided
    let assignedTo: string | null = null;
    let assignWarning: string | null = null;
    if (params.assign_to) {
      try {
        assignedTo = await resolveAgentId(params.assign_to, agentId);
      } catch (err) {
        assignWarning = `Could not assign to "${params.assign_to}": ${err instanceof Error ? err.message : String(err)}. Task created as unassigned.`;
        log.warn({ assignTo: params.assign_to }, assignWarning);
      }
    }

    const [task] = await db
      .insert(tasks)
      .values({
        title: params.title,
        description: params.description,
        createdBy: agentId,
        assignedTo,
        parentTaskId: params.parent_task_id ?? null,
        type: params.type ?? "task",
        projectId,
        priority: params.priority ?? 0,
        input: params.input ?? null,
        status: assignedTo ? "assigned" : "pending",
      })
      .returning();

    log.info({ taskId: task!.id, title: params.title, type: params.type ?? "task", projectId, assignedTo }, "Task created");

    return {
      task_id: task!.id,
      title: task!.title,
      type: task!.type,
      status: task!.status,
      assigned_to: task!.assignedTo,
      project_id: task!.projectId,
      ...(assignWarning ? { warning: assignWarning } : {}),
    };
  },
});
