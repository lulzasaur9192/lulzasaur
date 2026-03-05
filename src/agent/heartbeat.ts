import { eq, and, or, isNull, ne, gte, desc, sql, count, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { agents, heartbeatLog, messages, tasks, soulDefinitions, bulletinBoard, agentMemory, projects, knowledgeEntities, knowledgeRelations } from "../db/schema.js";
import { consolidateMemory } from "./memory-consolidation.js";
import { runAgentTurn } from "./runtime.js";
import { createChildLogger } from "../utils/logger.js";
import { isSlackConnected } from "../integrations/slack-ref.js";
import { getProjectChannels } from "../integrations/slack-channels.js";
import { getActiveScheduleInterval } from "./schedule-matcher.js";

const log = createChildLogger("heartbeat-runner");

export async function runHeartbeat(agent: typeof agents.$inferSelect): Promise<void> {
  const db = getDb();
  const startTime = Date.now();

  // Resolve heartbeat interval — schedules take priority over flat interval
  const { interval: heartbeatInterval, scheduleName: activeSchedule } = getActiveScheduleInterval(
    agent.schedules,
    agent.heartbeatIntervalSeconds ?? 300,
  );
  const hasHeartbeat = agent.heartbeatIntervalSeconds != null || (agent.schedules?.length ?? 0) > 0;

  // Log heartbeat start
  const [logEntry] = await db
    .insert(heartbeatLog)
    .values({ agentId: agent.id })
    .returning();

  try {
    // Load soul for goals/intent context
    let soulGoals: string[] = [];
    let soulIntent: string | null = null;
    if (agent.soulId) {
      const [soul] = await db
        .select()
        .from(soulDefinitions)
        .where(eq(soulDefinitions.id, agent.soulId))
        .limit(1);
      if (soul) {
        soulGoals = soul.goals as string[];
        soulIntent = soul.intent;
      }
    }

    // Gather context for heartbeat
    const unreadMessages = await db
      .select()
      .from(messages)
      .where(and(eq(messages.toAgentId, agent.id), isNull(messages.readAt)))
      .limit(10);

    // Tasks assigned TO this agent — active work
    const assignedTasks = await db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.assignedTo, agent.id),
        or(
          eq(tasks.status, "pending" as any),
          eq(tasks.status, "assigned" as any),
          eq(tasks.status, "in_progress" as any),
        ),
      ))
      .limit(10);

    // Tasks assigned to this agent that were rejected by user (need rework)
    // Only include tasks still in in_progress — not ones already re-submitted for review or completed
    const rejectedTasks = await db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.assignedTo, agent.id),
        eq(tasks.verificationStatus, "rejected" as any),
        eq(tasks.status, "in_progress" as any),
      ))
      .limit(10);

    // Tasks still pending user review (submitted but not yet approved/rejected)
    const reviewPendingTasks = await db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.assignedTo, agent.id),
        eq(tasks.status, "review_pending" as any),
      ))
      .limit(10);

    // Tasks created BY this agent (delegated work — check status)
    const delegatedTasks = await db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.createdBy, agent.id),
        or(
          eq(tasks.status, "pending" as any),
          eq(tasks.status, "assigned" as any),
          eq(tasks.status, "in_progress" as any),
          eq(tasks.status, "completed" as any),
          eq(tasks.status, "review_pending" as any),
        ),
      ))
      .limit(10);

    // ── Perform DB side effects before building context ──

    // Mark unread messages as read
    for (const msg of unreadMessages) {
      await db.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
    }

    // Move rejected tasks back to in_progress
    for (const task of rejectedTasks) {
      await db.update(tasks).set({
        status: "in_progress",
        verificationStatus: "unverified",
        updatedAt: new Date(),
      }).where(eq(tasks.id, task.id));
    }

    // Auto-transition pending/assigned → in_progress
    for (const task of assignedTasks) {
      if (task.status === "pending" || task.status === "assigned") {
        await db.update(tasks).set({
          status: "in_progress",
          updatedAt: new Date(),
        }).where(eq(tasks.id, task.id));
        task.status = "in_progress" as any;
      }
    }

    // Fetch bulletin posts
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const bulletinConditions = [
      or(isNull(bulletinBoard.expiresAt), gte(bulletinBoard.expiresAt, new Date()))!,
      gte(bulletinBoard.createdAt, oneDayAgo),
    ];
    if (agent.projectId) {
      bulletinConditions.push(
        or(eq(bulletinBoard.projectId, agent.projectId), isNull(bulletinBoard.projectId))!,
      );
    }
    const bulletinPosts = await db
      .select({
        post: bulletinBoard,
        author: agents,
      })
      .from(bulletinBoard)
      .leftJoin(agents, eq(bulletinBoard.authorAgentId, agents.id))
      .where(and(...bulletinConditions))
      .orderBy(desc(bulletinBoard.pinned), desc(bulletinBoard.createdAt))
      .limit(5);
    const otherAgentPosts = bulletinPosts.filter((p) => p.post.authorAgentId !== agent.id);

    // ── Build heartbeat prompt with token budget ──
    const HEARTBEAT_TOKEN_BUDGET = 4000;
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    // Collect context items with priority scores
    interface ContextItem { priority: number; text: string; tokens: number; category: string; count: number }
    const contextItems: ContextItem[] = [];

    // Unread messages (priority: 100)
    if (unreadMessages.length > 0) {
      let msgText = `\n## UNREAD MESSAGES (${unreadMessages.length}) — Read and act on these first:`;
      for (const msg of unreadMessages) {
        const contentStr = JSON.stringify(msg.content);
        const truncated = contentStr.length > 300 ? contentStr.substring(0, 300) + "..." : contentStr;
        msgText += `\n- [${msg.type}] from ${msg.fromAgentId}: ${truncated}`;
      }
      contextItems.push({ priority: 100, text: msgText, tokens: estimateTokens(msgText), category: "messages", count: unreadMessages.length });
    }

    // Rejected tasks (priority: 90)
    if (rejectedTasks.length > 0) {
      let rejText = `\n## REJECTED — Fix these:`;
      for (const task of rejectedTasks) {
        rejText += `\n- [REJECTED] ${task.title} (${task.id})`;
        rejText += `\n  Feedback: ${task.verificationNotes ?? "No feedback"}`;
        rejText += `\n  Previous result: ${task.result ? JSON.stringify(task.result).substring(0, 200) : "none"}`;
      }
      rejText += "\nAddress feedback and re-submit.";
      contextItems.push({ priority: 90, text: rejText, tokens: estimateTokens(rejText), category: "rejected", count: rejectedTasks.length });
    }

    // Assigned tasks — compact representation (priority: 80)
    if (assignedTasks.length > 0) {
      let taskText: string;
      if (assignedTasks.length <= 5) {
        taskText = `\n## YOUR TASKS (${assignedTasks.length}):`;
        for (const task of assignedTasks) {
          const descSnippet = task.description?.substring(0, 100) + (task.description && task.description.length > 100 ? "..." : "");
          taskText += `\n- [${task.status}] ${task.title} (${task.id}): ${descSnippet}`;
        }
      } else {
        // Compact representation for many tasks
        taskText = `\n## YOUR TASKS (${assignedTasks.length} active)\nTop priority:`;
        for (const task of assignedTasks.slice(0, 3)) {
          taskText += `\n${assignedTasks.indexOf(task) + 1}. ${task.title} (${task.id}) [${task.status}]`;
        }
        taskText += `\nUse query_tasks for full details.`;
      }
      taskText += "\nPick up where you left off.";
      contextItems.push({ priority: 80, text: taskText, tokens: estimateTokens(taskText), category: "tasks", count: assignedTasks.length });

      // ── D1: Inject prior attempts for assigned tasks (priority: 85) ──
      for (const task of assignedTasks) {
        try {
          const attemptName = `task-${task.id}-attempt`;
          const [priorAttempt] = await db
            .select()
            .from(knowledgeEntities)
            .where(and(
              eq(knowledgeEntities.agentId, agent.id),
              eq(knowledgeEntities.name, attemptName),
              eq(knowledgeEntities.entityType, "lesson"),
            ))
            .limit(1);

          if (priorAttempt) {
            const truncContent = priorAttempt.content.length > 500
              ? priorAttempt.content.substring(0, 500) + "..."
              : priorAttempt.content;
            const attemptText = `\n## PRIOR ATTEMPT on "${task.title}" (${task.id}):\n${truncContent}\nDo NOT repeat the same approach if it failed.`;
            contextItems.push({ priority: 85, text: attemptText, tokens: estimateTokens(attemptText), category: "prior-attempt", count: 1 });
          }
        } catch (attemptErr) {
          log.warn({ taskId: task.id, error: attemptErr }, "Failed to load prior attempt for task");
        }
      }
    }

    // Delegated tasks (priority: 50)
    if (delegatedTasks.length > 0) {
      const completedCount = delegatedTasks.filter((t) => t.status === "completed").length;
      let delText: string;
      if (delegatedTasks.length <= 5) {
        delText = `\n## DELEGATED (${delegatedTasks.length}):`;
        for (const task of delegatedTasks) {
          const resultSnippet = task.result ? ` — result: ${JSON.stringify(task.result).substring(0, 100)}` : "";
          delText += `\n- [${task.status}] ${task.title}${resultSnippet}`;
        }
      } else {
        delText = `\n## DELEGATED (${delegatedTasks.length}): ${completedCount} completed, ${delegatedTasks.length - completedCount} in progress.`;
        delText += `\nUse query_tasks for details.`;
      }
      if (completedCount > 0) {
        delText += `\n${completedCount} completed — review and verify.`;
      }
      contextItems.push({ priority: 50, text: delText, tokens: estimateTokens(delText), category: "delegated", count: delegatedTasks.length });
    }

    // Review pending (priority: 20)
    if (reviewPendingTasks.length > 0) {
      const revText = `\n## AWAITING REVIEW (${reviewPendingTasks.length}) — waiting for user.`;
      contextItems.push({ priority: 20, text: revText, tokens: estimateTokens(revText), category: "reviews", count: reviewPendingTasks.length });
    }

    // Bulletin posts (priority: 10)
    if (otherAgentPosts.length > 0) {
      let bulText = `\n## BULLETIN:`;
      for (const p of otherAgentPosts) {
        bulText += `\n- [${p.post.channel}] ${p.author?.name ?? "unknown"}: ${p.post.title}`;
        bulText += `\n  ${p.post.body.substring(0, 150)}`;
      }
      contextItems.push({ priority: 10, text: bulText, tokens: estimateTokens(bulText), category: "bulletin", count: otherAgentPosts.length });
    }

    // ── Compute reactive-work booleans early (used for auto-inject gating + proactive phase) ──
    const hasReactiveWork = unreadMessages.length > 0 || rejectedTasks.length > 0 || assignedTasks.length > 0;
    const hasDelegatedWork = delegatedTasks.length > 0;
    const hasReviewsPending = reviewPendingTasks.length > 0;
    const hasBulletinPosts = otherAgentPosts.length > 0;
    const isProactiveSession = !hasReactiveWork && !hasDelegatedWork && !hasReviewsPending && !hasBulletinPosts;

    // ── Auto-inject agent memories (priority: 60) ──
    // Skip for proactive sessions — those already have a richer KG review section
    if (!isProactiveSession) {
      try {
        // Load recent KV memories
        const recentMemories = await db
          .select()
          .from(agentMemory)
          .where(and(
            eq(agentMemory.agentId, agent.id),
            ne(agentMemory.namespace, "system"),
          ))
          .orderBy(desc(agentMemory.updatedAt))
          .limit(10);

        // Load top KG entities — composite relevance: confidence + recency + access frequency
        const topEntities = await db
          .select()
          .from(knowledgeEntities)
          .where(and(
            eq(knowledgeEntities.agentId, agent.id),
            gte(knowledgeEntities.confidence, 50),
          ))
          .orderBy(desc(knowledgeEntities.confidence), desc(knowledgeEntities.lastAccessedAt))
          .limit(8);

        // Bump access counts on auto-injected entities
        const autoEntityIds = topEntities.map((e) => e.id);
        if (autoEntityIds.length > 0) {
          await db
            .update(knowledgeEntities)
            .set({
              accessCount: sql`${knowledgeEntities.accessCount} + 1`,
              lastAccessedAt: new Date(),
            })
            .where(inArray(knowledgeEntities.id, autoEntityIds));
        }

        if (recentMemories.length > 0 || topEntities.length > 0) {
          let memText = `\n## YOUR MEMORY (auto-loaded):`;

          if (recentMemories.length > 0) {
            memText += `\nKey-value notes:`;
            for (const mem of recentMemories) {
              const valStr = typeof mem.value === "string" ? mem.value : JSON.stringify(mem.value);
              const truncVal = valStr.length > 120 ? valStr.substring(0, 120) + "..." : valStr;
              memText += `\n- [${mem.namespace}/${mem.key}]: ${truncVal}`;
            }
          }

          if (topEntities.length > 0) {
            memText += `\nKnowledge graph:`;
            for (const entity of topEntities) {
              const truncContent = entity.content.length > 100
                ? entity.content.substring(0, 100) + "..."
                : entity.content;
              memText += `\n- [${entity.entityType}] ${entity.name} (c:${entity.confidence}): ${truncContent}`;
            }
          }

          // Cap at ~800 tokens (~20% of 4000 budget)
          const memTokens = estimateTokens(memText);
          if (memTokens <= 800) {
            contextItems.push({ priority: 60, text: memText, tokens: memTokens, category: "memory", count: recentMemories.length + topEntities.length });
          } else {
            // Truncate to fit within 800 token budget
            const truncated = memText.substring(0, 3200); // ~800 tokens at 4 chars/token
            contextItems.push({ priority: 60, text: truncated, tokens: 800, category: "memory", count: recentMemories.length + topEntities.length });
          }
        }
      } catch (memError) {
        log.warn({ agentId: agent.id, error: memError }, "Failed to auto-inject memories into heartbeat");
      }
    }

    // Sort by priority (highest first), then fill budget
    contextItems.sort((a, b) => b.priority - a.priority);

    const header = "[HEARTBEAT] You are waking up. Check your work and take action.";
    const parts: string[] = [header];
    let remainingBudget = HEARTBEAT_TOKEN_BUDGET - estimateTokens(header);

    // Add Slack channels (small, always included if present)
    if (agent.projectId && isSlackConnected()) {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, agent.projectId))
        .limit(1);
      if (project) {
        const projectChannels = getProjectChannels(agent.projectId);
        if (projectChannels && projectChannels.size > 0) {
          const channelList = Array.from(projectChannels.entries())
            .map(([purpose]) => `- #${project.name}${purpose === "general" ? "" : "-" + purpose} (${purpose})`)
            .join("\n");
          const slackText = `\nSlack channels:\n${channelList}`;
          parts.push(slackText);
          remainingBudget -= estimateTokens(slackText);
        }
      }
    }

    const overflow: string[] = [];
    for (const item of contextItems) {
      if (item.tokens <= remainingBudget) {
        parts.push(item.text);
        remainingBudget -= item.tokens;
      } else {
        overflow.push(`${item.count} ${item.category}`);
      }
    }

    if (overflow.length > 0) {
      parts.push(`\n...and ${overflow.join(", ")} not shown (use query_tasks/read_messages to see all).`);
    }

    // PROACTIVE PHASE — when there's no reactive work, think about initiative
    // (booleans already computed above for auto-inject gating)

    // When there's no reactive work, check if it's time for the daily proactive session
    if (isProactiveSession) {
      // Check when this agent last had a proactive thinking session
      const PROACTIVE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
      const proactiveKey = "last_proactive_session";
      const [lastProactive] = await db
        .select()
        .from(agentMemory)
        .where(and(
          eq(agentMemory.agentId, agent.id),
          eq(agentMemory.namespace, "system"),
          eq(agentMemory.key, proactiveKey),
        ))
        .limit(1);

      const lastProactiveTime = lastProactive ? new Date(lastProactive.value as string).getTime() : 0;
      const isDueForProactive = Date.now() - lastProactiveTime >= PROACTIVE_INTERVAL_MS;

      if (!isDueForProactive) {
        // Not time yet — skip LLM call entirely
        log.debug({ agentId: agent.id, activeSchedule, heartbeatInterval }, "Heartbeat skipped — no work to do");

        const durationMs = Date.now() - startTime;
        await db
          .update(heartbeatLog)
          .set({
            completedAt: new Date(),
            durationMs,
            result: { skipped: true, reason: "no_work" },
          })
          .where(eq(heartbeatLog.id, logEntry!.id));

        if (hasHeartbeat) {
          await db
            .update(agents)
            .set({
              nextHeartbeatAt: new Date(Date.now() + heartbeatInterval * 1000),
              updatedAt: new Date(),
            })
            .where(eq(agents.id, agent.id));
        }

        return;
      }

      // Run memory consolidation before the proactive LLM call
      try {
        const consolidationResult = await consolidateMemory(agent);
        log.info({ agentId: agent.id, ...consolidationResult }, "Memory consolidation complete");
      } catch (consError) {
        log.warn({ agentId: agent.id, error: consError }, "Memory consolidation failed, continuing");
      }

      // Daily proactive session — let the agent think about its prime directive
      log.info({ agentId: agent.id }, "Running daily proactive thinking session");

      parts.push(`\n## DAILY PROACTIVE SESSION — Think about your prime directive.`);
      if (soulIntent) {
        parts.push(`\nYour prime directive: "${soulIntent}"`);
      }
      // Load soul capabilities to determine how this agent should communicate
      let soulCaps: string[] = [];
      if (agent.soulId) {
        const [soulDef] = await db
          .select()
          .from(soulDefinitions)
          .where(eq(soulDefinitions.id, agent.soulId))
          .limit(1);
        if (soulDef) soulCaps = soulDef.capabilities as string[];
      }
      const canMessageUser = soulCaps.includes("message_user");
      const escalationAdvice = canMessageUser
        ? "- Should you propose a new project or initiative to the user? (use message_user with type 'proposal')"
        : "- Should you share discoveries or status updates? Post to the bulletin_board so the orchestrator and other agents can see.";

      parts.push(
        "\nThis is your once-daily chance to propose initiatives. Consider:",
        "- Is there work you could do proactively that furthers your goals?",
        "- Have you noticed anything in previous tasks that could be improved?",
        escalationAdvice,
        "- Can you check on things related to your domain (files, systems, data) and report findings?",
        "- If you have nothing valuable to propose, that's fine — just say so.",
        "\nDo NOT invent busywork. Only act if you have a genuinely useful idea.",
      );

      // ── Knowledge Graph Promotion ──
      // Show agent's top entities so it can review/update its knowledge
      if (soulCaps.includes("knowledge_graph")) {
        const kgConditions = [
          eq(knowledgeEntities.agentId, agent.id),
          gte(knowledgeEntities.confidence, 70),
        ];

        const topEntities = await db
          .select()
          .from(knowledgeEntities)
          .where(and(...kgConditions))
          .orderBy(desc(knowledgeEntities.confidence), desc(knowledgeEntities.updatedAt))
          .limit(10);

        if (topEntities.length > 0) {
          let kgText = "\n## KNOWLEDGE GRAPH — Your top entities:";
          for (const entity of topEntities) {
            const [outCount] = await db
              .select({ count: count() })
              .from(knowledgeRelations)
              .where(eq(knowledgeRelations.sourceEntityId, entity.id));
            const [inCount] = await db
              .select({ count: count() })
              .from(knowledgeRelations)
              .where(eq(knowledgeRelations.targetEntityId, entity.id));
            const connections = (outCount!.count as number) + (inCount!.count as number);
            const truncContent = entity.content.length > 80
              ? entity.content.substring(0, 80) + "..."
              : entity.content;
            kgText += `\n- [${entity.entityType}] ${entity.name} (confidence: ${entity.confidence}, connections: ${connections}): ${truncContent}`;
          }
          kgText += "\n\nAre any facts outdated? Learned anything new? Missing connections?";
          kgText += "\nUse kg_store to update, kg_traverse to explore connections.";

          // Show cross-agent entities if agent has a project
          if (agent.projectId) {
            const crossAgentEntities = await db
              .select({
                entity: knowledgeEntities,
                authorName: agents.name,
              })
              .from(knowledgeEntities)
              .leftJoin(agents, eq(knowledgeEntities.agentId, agents.id))
              .where(and(
                eq(knowledgeEntities.projectId, agent.projectId),
                gte(knowledgeEntities.confidence, 70),
                // Exclude own entities — using sql for not-equal
                sql`${knowledgeEntities.agentId} != ${agent.id}`,
              ))
              .orderBy(desc(knowledgeEntities.confidence), desc(knowledgeEntities.updatedAt))
              .limit(5);

            if (crossAgentEntities.length > 0) {
              kgText += "\n\n### Other agents' knowledge in your project:";
              for (const r of crossAgentEntities) {
                const truncContent = r.entity.content.length > 80
                  ? r.entity.content.substring(0, 80) + "..."
                  : r.entity.content;
                kgText += `\n- [${r.entity.entityType}] ${r.entity.name} by ${r.authorName ?? "unknown"}: ${truncContent}`;
              }
            }
          }

          parts.push(kgText);
        }
      }

      // Record that we did the proactive session
      if (lastProactive) {
        await db
          .update(agentMemory)
          .set({ value: new Date().toISOString(), updatedAt: new Date() })
          .where(eq(agentMemory.id, lastProactive.id));
      } else {
        await db.insert(agentMemory).values({
          agentId: agent.id,
          namespace: "system",
          key: proactiveKey,
          value: new Date().toISOString(),
        });
      }
    } else if (!hasReactiveWork && !hasDelegatedWork) {
      parts.push("\nYou have reviews pending user response. No other work to do right now.");
    }

    // Run agent turn with heartbeat context
    const result = await runAgentTurn(agent.id, parts.join("\n"));

    // Update heartbeat log
    const durationMs = Date.now() - startTime;
    await db
      .update(heartbeatLog)
      .set({
        completedAt: new Date(),
        durationMs,
        result: { response: result.response, toolCalls: result.toolCalls.length },
      })
      .where(eq(heartbeatLog.id, logEntry!.id));

    // Schedule next heartbeat
    if (hasHeartbeat) {
      await db
        .update(agents)
        .set({
          nextHeartbeatAt: new Date(Date.now() + heartbeatInterval * 1000),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    }

    if (activeSchedule) {
      log.debug({ agentId: agent.id, durationMs, scheduleName: activeSchedule, heartbeatInterval }, "Heartbeat completed (scheduled interval)");
    } else {
      log.debug({ agentId: agent.id, durationMs, heartbeatInterval }, "Heartbeat completed");
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    await db
      .update(heartbeatLog)
      .set({
        completedAt: new Date(),
        durationMs,
        error: errorMsg,
      })
      .where(eq(heartbeatLog.id, logEntry!.id));

    // Post failure to bulletin board so orchestrator/sysadmin can see it
    try {
      await db.insert(bulletinBoard).values({
        authorAgentId: agent.id,
        channel: "status-updates",
        title: `[ERROR] ${agent.name} heartbeat failed`,
        body: `Agent \`${agent.name}\` (model: ${agent.model}, provider: ${agent.provider}) failed during heartbeat.\n\nError: ${errorMsg.substring(0, 500)}\n\nDuration: ${durationMs}ms`,
        tags: ["error", "heartbeat-failure"],
      });
    } catch (postErr) {
      log.warn({ agentId: agent.id, error: String(postErr) }, "Failed to post heartbeat error to bulletin board");
    }

    // Still schedule next heartbeat even on failure
    if (hasHeartbeat) {
      await db
        .update(agents)
        .set({
          nextHeartbeatAt: new Date(Date.now() + heartbeatInterval * 1000),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    }

    throw error;
  }
}
