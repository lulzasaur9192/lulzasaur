import { config as loadDotenv } from "dotenv";
loadDotenv();

import { getDb } from "../../db/client.js";
import { agents, tasks, heartbeatLog, conversations, messages, soulDefinitions, goalEvaluations } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { loadConfig } from "../../config/index.js";
import { cloneSoul } from "../../core/soul.js";
import { onReviewRequested } from "../../tools/built-in/request-review.js";

loadConfig();

export async function listAgentsCmd() {
  const db = getDb();
  const rows = await db.select().from(agents).orderBy(desc(agents.createdAt));
  if (rows.length === 0) {
    console.log("No agents found.");
    return;
  }
  console.log(`\n  ${"ID".padEnd(38)} ${"Name".padEnd(25)} ${"Status".padEnd(12)} ${"Depth"} ${"Model"}`);
  console.log("  " + "─".repeat(100));
  for (const a of rows) {
    console.log(
      `  ${a.id.padEnd(38)} ${a.name.padEnd(25)} ${a.status.padEnd(12)} ${String(a.depth).padEnd(5)} ${a.model ?? "default"}`,
    );
  }
  console.log();
}

export async function listTasksCmd() {
  const db = getDb();
  const rows = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(30);
  if (rows.length === 0) {
    console.log("No tasks found.");
    return;
  }
  console.log(`\n  ${"ID".substring(0, 8).padEnd(10)} ${"Title".padEnd(35)} ${"Status".padEnd(14)} ${"Verified".padEnd(12)} ${"Assigned To"}`);
  console.log("  " + "─".repeat(90));
  for (const t of rows) {
    console.log(
      `  ${t.id.substring(0, 8).padEnd(10)} ${t.title.substring(0, 33).padEnd(35)} ${t.status.padEnd(14)} ${t.verificationStatus.padEnd(12)} ${t.assignedTo?.substring(0, 8) ?? "—"}`,
    );
  }
  console.log();
}

export async function heartbeatsLogCmd() {
  const db = getDb();
  const rows = await db
    .select()
    .from(heartbeatLog)
    .orderBy(desc(heartbeatLog.triggeredAt))
    .limit(20);
  if (rows.length === 0) {
    console.log("No heartbeat logs found.");
    return;
  }
  console.log(`\n  ${"Agent".padEnd(10)} ${"Triggered".padEnd(25)} ${"Duration".padEnd(10)} ${"Error"}`);
  console.log("  " + "─".repeat(70));
  for (const h of rows) {
    console.log(
      `  ${h.agentId.substring(0, 8).padEnd(10)} ${h.triggeredAt.toISOString().padEnd(25)} ${(h.durationMs ? `${h.durationMs}ms` : "—").padEnd(10)} ${h.error ?? "✓"}`,
    );
  }
  console.log();
}

export async function conversationsCmd(agentId?: string) {
  const db = getDb();
  let query = db.select().from(conversations).orderBy(desc(conversations.createdAt)).limit(10);
  if (agentId) {
    query = query.where(eq(conversations.agentId, agentId)) as any;
  }
  const rows = await query;
  if (rows.length === 0) {
    console.log("No conversations found.");
    return;
  }
  for (const c of rows) {
    const msgs = c.messages as any[];
    console.log(`\n  Conversation ${c.id.substring(0, 8)} (agent: ${c.agentId.substring(0, 8)}, active: ${c.isActive}, messages: ${msgs.length}, tokens: ${c.tokenCount})`);
    if (c.summary) {
      console.log(`  Summary: ${c.summary.substring(0, 200)}...`);
    }
  }
  console.log();
}

export async function messagesCmd() {
  const db = getDb();
  const rows = await db.select().from(messages).orderBy(desc(messages.createdAt)).limit(20);
  if (rows.length === 0) {
    console.log("No messages found.");
    return;
  }
  console.log(`\n  ${"Type".padEnd(20)} ${"From".padEnd(10)} ${"To".padEnd(10)} ${"Read".padEnd(6)} ${"Content"}`);
  console.log("  " + "─".repeat(80));
  for (const m of rows) {
    const content = JSON.stringify(m.content).substring(0, 40);
    console.log(
      `  ${m.type.padEnd(20)} ${(m.fromAgentId?.substring(0, 8) ?? "system").padEnd(10)} ${m.toAgentId.substring(0, 8).padEnd(10)} ${(m.readAt ? "✓" : "—").padEnd(6)} ${content}`,
    );
  }
  console.log();
}

export async function soulsCmd() {
  const db = getDb();
  const rows = await db.select().from(soulDefinitions).orderBy(desc(soulDefinitions.createdAt));
  if (rows.length === 0) {
    console.log("No soul definitions found.");
    return;
  }
  console.log(`\n  ${"Name".padEnd(25)} ${"Intent".padEnd(50)} ${"Caps".padEnd(5)} ${"Goals"}`);
  console.log("  " + "─".repeat(95));
  for (const s of rows) {
    const intent = (s.intent ?? "—").substring(0, 48);
    const caps = (s.capabilities as string[]).length;
    const goals = (s.goals as string[]).length;
    console.log(`  ${s.name.padEnd(25)} ${intent.padEnd(50)} ${String(caps).padEnd(5)} ${goals}`);
  }
  console.log();
}

export async function cloneSoulCmd(args: string[]) {
  if (args.length < 2) {
    console.log("Usage: /clone <source-soul> <new-name>");
    return;
  }
  const [source, newName] = args;
  try {
    const cloned = await cloneSoul(source!, newName!);
    console.log(`\n  Cloned "${source}" → "${newName}" (id: ${cloned.id.substring(0, 8)})`);
    console.log(`  Edit the YAML or use /souls to verify.\n`);
  } catch (error) {
    console.error(`Clone failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function goalsCmd(agentId?: string) {
  const db = getDb();
  let query = db.select().from(goalEvaluations).orderBy(desc(goalEvaluations.evaluatedAt)).limit(30);
  if (agentId) {
    query = query.where(eq(goalEvaluations.agentId, agentId)) as any;
  }
  const rows = await query;
  if (rows.length === 0) {
    console.log("No goal evaluations yet.");
    return;
  }
  console.log(`\n  ${"Agent".padEnd(10)} ${"Pass".padEnd(6)} ${"Goal".padEnd(45)} ${"Evidence"}`);
  console.log("  " + "─".repeat(90));
  for (const g of rows) {
    const pass = g.passed ? "✓" : "✗";
    console.log(
      `  ${g.agentId.substring(0, 8).padEnd(10)} ${pass.padEnd(6)} ${g.goal.substring(0, 43).padEnd(45)} ${(g.evidence ?? "—").substring(0, 30)}`,
    );
  }
  console.log();
}

export async function reviewsCmd() {
  const db = getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "review_pending" as any))
    .orderBy(desc(tasks.updatedAt));
  if (rows.length === 0) {
    console.log("No tasks pending review.");
    return;
  }
  console.log(`\n  Tasks awaiting your review:\n`);
  for (const t of rows) {
    const result = t.result as Record<string, unknown> | null;
    console.log(`  [${t.id.substring(0, 8)}] ${t.title}`);
    if (result?.summary) console.log(`    Summary: ${result.summary}`);
    if (result?.evidence) console.log(`    Evidence: ${String(result.evidence).substring(0, 200)}`);
    console.log();
  }
  console.log(`  Use /approve <id> or /reject <id> <feedback> to respond.\n`);
}

export async function approveTaskCmd(args: string[]) {
  const db = getDb();
  const { and: andOp } = await import("drizzle-orm");

  // Find all review-pending tasks
  const allReviewPending = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "review_pending" as any));

  // Also find plan epics with planned children (approvable plans)
  const allPlannedEpics = await db
    .select()
    .from(tasks)
    .where(andOp(eq(tasks.type, "epic" as any), eq(tasks.status, "review_pending" as any)));

  // Check for epics that have planned children even if not in review_pending
  let planEpicIds = new Set<string>();
  if (args.length > 0 && args[0]) {
    // If user specified an ID, check if it's a plan epic
    const prefix = args[0];
    const allTasks = await db.select().from(tasks);
    const matchingTask = allTasks.find((t) => t.id.startsWith(prefix));
    if (matchingTask) {
      const plannedChildren = await db
        .select()
        .from(tasks)
        .where(andOp(eq(tasks.parentTaskId, matchingTask.id), eq(tasks.status, "planned" as any)));

      if (plannedChildren.length > 0) {
        // This is a plan approval
        await db
          .update(tasks)
          .set({ status: "pending", updatedAt: new Date() })
          .where(andOp(eq(tasks.parentTaskId, matchingTask.id), eq(tasks.status, "planned" as any)));
        await db
          .update(tasks)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(tasks.id, matchingTask.id));

        if (matchingTask.assignedTo) {
          await db.insert(messages).values({
            type: "task_verification",
            toAgentId: matchingTask.assignedTo,
            taskId: matchingTask.id,
            content: { action: "plan_approved", tasks_activated: plannedChildren.length },
          });
        }

        // Trigger dispatcher
        try {
          const { runDispatchCycle } = await import("../../tasks/task-dispatcher.js");
          await runDispatchCycle(new Map(), (p) => 3);
        } catch {}

        console.log(`\n  Plan approved: ${matchingTask.title} (${matchingTask.id.substring(0, 8)})`);
        console.log(`  ${plannedChildren.length} tasks activated.\n`);
        return;
      }
    }
  }

  if (allReviewPending.length === 0) {
    console.log("No tasks pending review.");
    return;
  }

  let task: typeof allReviewPending[number] | undefined;

  if (args.length < 1 || !args[0]) {
    // No ID provided — auto-select if there's exactly one
    if (allReviewPending.length === 1) {
      task = allReviewPending[0];
    } else {
      console.log(`Multiple tasks pending review. Specify an ID prefix:`);
      for (const t of allReviewPending) {
        console.log(`  ${t.id.substring(0, 8)} — ${t.title}`);
      }
      return;
    }
  } else {
    const prefix = args[0]!;
    task = allReviewPending.find((t) => t.id.startsWith(prefix));
  }

  if (!task) {
    console.log(`No review-pending task matching "${args[0]}".`);
    return;
  }

  await db.update(tasks).set({
    status: "completed",
    verificationStatus: "verified",
    verificationNotes: "Approved by user",
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(tasks.id, task.id));

  // Send approval message to the assigned agent
  if (task.assignedTo) {
    await db.insert(messages).values({
      type: "task_verification",
      toAgentId: task.assignedTo,
      taskId: task.id,
      content: { action: "approved", message: "User approved your work. Task is complete." },
    });
  }

  console.log(`\n  Approved: ${task.title} (${task.id.substring(0, 8)})\n`);
}

export async function rejectTaskCmd(args: string[]) {
  const db = getDb();

  const allReviewPending = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "review_pending" as any));

  if (allReviewPending.length === 0) {
    console.log("No tasks pending review.");
    return;
  }

  let task: typeof allReviewPending[number] | undefined;
  let feedback: string;

  if (args.length < 1 || !args[0]) {
    if (allReviewPending.length === 1) {
      task = allReviewPending[0];
      feedback = "Rejected — needs changes.";
    } else {
      console.log(`Multiple tasks pending review. Specify an ID prefix:`);
      for (const t of allReviewPending) {
        console.log(`  ${t.id.substring(0, 8)} — ${t.title}`);
      }
      return;
    }
  } else {
    // Check if first arg looks like a task ID prefix (hex chars)
    const maybePrefix = args[0]!;
    const looksLikeId = /^[0-9a-f]{4,}$/i.test(maybePrefix);

    if (looksLikeId) {
      task = allReviewPending.find((t) => t.id.startsWith(maybePrefix));
      feedback = args.slice(1).join(" ") || "Rejected — needs changes.";
    } else if (allReviewPending.length === 1) {
      // No ID but only one task — treat entire args as feedback
      task = allReviewPending[0];
      feedback = args.join(" ");
    } else {
      console.log(`Multiple tasks pending. Specify which one: /reject <id-prefix> <feedback>`);
      for (const t of allReviewPending) {
        console.log(`  ${t.id.substring(0, 8)} — ${t.title}`);
      }
      return;
    }
  }

  if (!task) {
    console.log(`No review-pending task matching "${args[0]}".`);
    return;
  }

  await db.update(tasks).set({
    status: "in_progress",
    verificationStatus: "rejected",
    verificationNotes: feedback,
    updatedAt: new Date(),
  }).where(eq(tasks.id, task.id));

  // Send rejection feedback to the assigned agent
  if (task.assignedTo) {
    await db.insert(messages).values({
      type: "task_verification",
      toAgentId: task.assignedTo,
      taskId: task.id,
      content: { action: "rejected", feedback },
    });
  }

  console.log(`\n  Rejected: ${task.title} (${task.id.substring(0, 8)})`);
  console.log(`  Feedback: ${feedback}\n`);
}

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const YELLOW = "\x1b[33m";

/** Register CLI as a review notification listener */
export function setupReviewNotifications() {
  onReviewRequested((review) => {
    console.log(`\n  ${YELLOW}Review requested:${RESET} ${review.title}`);
    console.log(`  ${DIM}${review.summary}${RESET}`);
    console.log(`  ${DIM}Type "approve" or "reject <feedback>"${RESET}\n`);
  });
}

export function printHelp() {
  console.log(`
  Lulzasaur CLI Commands:
    /agents              List all agents
    /souls               List all soul definitions
    /clone <s> <n>       Clone soul <s> as <n> (duplicate & remix)
    /tasks               List all tasks
    /reviews             Show tasks pending your review
    /approve [id]        Approve a task (auto-selects if only one pending)
    /reject [id] [why]   Reject a task with feedback (agent will rework)
    /goals [agent]       Show goal evaluations
    /heartbeats          Show heartbeat log
    /conversations       Show recent conversations
    /messages            Show recent inter-agent messages
    /help                Show this help
    /quit                Exit

  Shortcuts: "approve" and "reject" work without the "/" prefix.
  Anything else is sent as a chat message to the orchestrator.
`);
}
