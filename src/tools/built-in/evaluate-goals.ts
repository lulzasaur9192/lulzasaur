import { registerTool } from "../tool-registry.js";
import { getDb } from "../../db/client.js";
import { goalEvaluations, agents, soulDefinitions } from "../../db/schema.js";
import { eq } from "drizzle-orm";

registerTool({
  name: "evaluate_goals",
  description:
    "Evaluate whether an agent's work on a task met its defined goals. " +
    "Use after verifying a task to record pass/fail for each of the agent's goals.",
  capability: "evaluate_goals",
  inputSchema: {
    type: "object",
    properties: {
      agentId: { type: "string", description: "The agent whose goals to evaluate" },
      taskId: { type: "string", description: "The task that was completed (optional)" },
      evaluations: {
        type: "array",
        description: "One evaluation per goal",
        items: {
          type: "object",
          properties: {
            goal: { type: "string", description: "The goal text (must match a goal from the soul)" },
            passed: { type: "boolean", description: "Whether the goal was met" },
            evidence: { type: "string", description: "Brief evidence for the pass/fail judgment" },
          },
          required: ["goal", "passed"],
        },
      },
    },
    required: ["agentId", "evaluations"],
  },
  execute: async (_callerAgentId: string, input: any) => {
    const db = getDb();

    // Verify agent exists
    const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
    if (!agent) return { error: `Agent ${input.agentId} not found` };

    const results = [];
    for (const evaluation of input.evaluations) {
      const [row] = await db
        .insert(goalEvaluations)
        .values({
          agentId: input.agentId,
          goal: evaluation.goal,
          passed: evaluation.passed,
          evidence: evaluation.evidence ?? null,
          taskId: input.taskId ?? null,
        })
        .returning();
      results.push(row);
    }

    return {
      evaluated: results.length,
      passed: results.filter((r: any) => r!.passed).length,
      failed: results.filter((r: any) => !r!.passed).length,
    };
  },
});
