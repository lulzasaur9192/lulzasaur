import { eq, and, or, isNull } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { resolveAgentId } from "../resolve-agent.js";

interface QueryTasksInput {
  status?: string;
  assigned_to?: string;
  created_by?: string;
  parent_task_id?: string;
  project_id?: string;
  type?: "task" | "epic";
  limit?: number;
}

registerTool({
  name: "query_tasks",
  description: "Query tasks from the database with optional filters. Use to check status of sub-tasks. Filter by project_id to scope to a project, or by type to find epics.",
  capability: "query_tasks",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter by status (pending, assigned, in_progress, completed, failed)" },
      assigned_to: { type: "string", description: "Filter by assigned agent ID" },
      created_by: { type: "string", description: "Filter by creator agent ID (use 'me' for self)" },
      parent_task_id: { type: "string", description: "Filter by parent task ID" },
      project_id: { type: "string", description: "Filter by project ID" },
      type: { type: "string", enum: ["task", "epic"], description: "Filter by type: 'task' or 'epic'" },
      limit: { type: "number", description: "Max results (default: 20)" },
    },
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as QueryTasksInput;

    const conditions = [];
    if (params.status) conditions.push(eq(tasks.status, params.status as any));
    if (params.assigned_to) {
      const assigneeId = await resolveAgentId(params.assigned_to, agentId);
      conditions.push(eq(tasks.assignedTo, assigneeId));
    }
    if (params.created_by) {
      const creatorId = await resolveAgentId(params.created_by, agentId);
      conditions.push(eq(tasks.createdBy, creatorId));
    }
    if (params.parent_task_id) conditions.push(eq(tasks.parentTaskId, params.parent_task_id));
    if (params.project_id) conditions.push(eq(tasks.projectId, params.project_id));
    if (params.type) conditions.push(eq(tasks.type, params.type as any));

    let query = db.select().from(tasks);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    const results = await (query as any).limit(params.limit ?? 20);

    return {
      tasks: results.map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        type: t.type,
        verification_status: t.verificationStatus,
        assigned_to: t.assignedTo,
        created_by: t.createdBy,
        project_id: t.projectId,
        parent_task_id: t.parentTaskId,
        result: t.result,
        created_at: t.createdAt,
        completed_at: t.completedAt,
      })),
      count: results.length,
    };
  },
});
