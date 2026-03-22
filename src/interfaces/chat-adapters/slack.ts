import { App, type LogLevel } from "@slack/bolt";
import type { ChatAdapter } from "./adapter-types.js";
import { createChildLogger, getDb, agents, tasks, messages, type AgentInput } from "../../shared.js";
import { onReviewRequested, offReviewRequested } from "../../tools/built-in/request-review.js";
import { eq, ne, sql } from "drizzle-orm";
import { getConfig } from "../../config/index.js";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const log = createChildLogger("slack");

let _slackAdapter: SlackAdapter | null = null;

export function getSlackAdapter(): SlackAdapter | null {
  return _slackAdapter;
}

export class SlackAdapter implements ChatAdapter {
  name = "slack";
  private app: App | null = null;
  private messageHandler: ((input: AgentInput) => Promise<string>) | null = null;
  private botToken: string;
  private signingSecret: string;
  private appToken: string;
  private allowedChannels: string[];
  private botUserId: string | null = null;
  private reviewHandler: ((review: any) => void) | null = null;
  private notifierRegistered = false;
  private isConnected = false;
  private ccSessions: Map<string, string> = new Map();
  private agentChannelMap: Map<string, string> = new Map();
  private channelAgentMap: Map<string, string> = new Map(); // reverse: channel ID → agent name
  private agentChannelCache: Map<string, string> = new Map();
  private defaultChannel: string | undefined;

  constructor(options: {
    botToken: string;
    signingSecret: string;
    appToken: string;
    allowedChannels?: string[];
    agentChannels?: string;
    defaultChannel?: string;
  }) {
    this.botToken = options.botToken;
    this.signingSecret = options.signingSecret;
    this.appToken = options.appToken;
    this.allowedChannels = options.allowedChannels ?? [];
    this.defaultChannel = options.defaultChannel;

    // Parse "researcher=C0X,marketing=C0Y" into Map (and build reverse map)
    if (options.agentChannels) {
      for (const pair of options.agentChannels.split(",")) {
        const [name, channelId] = pair.split("=");
        if (name && channelId) {
          this.agentChannelMap.set(name.trim(), channelId.trim());
          // For reverse map, first agent wins (monitor shares sysops channel — sysops takes priority)
          if (!this.channelAgentMap.has(channelId.trim())) {
            this.channelAgentMap.set(channelId.trim(), name.trim());
          }
        }
      }
    }

    _slackAdapter = this;
  }

  async start(): Promise<void> {
    this.app = new App({
      token: this.botToken,
      signingSecret: this.signingSecret,
      appToken: this.appToken,
      socketMode: true,
      logLevel: "ERROR" as LogLevel,
    });

    // Interactive button handlers for approve/reject
    this.app.action("approve_task", async ({ body, ack, client }) => {
      await ack();
      const action = (body as any).actions?.[0];
      const taskId = action?.value;
      if (!taskId) return;

      const result = await this.executeReviewAction("approve", taskId);
      const channel = (body as any).channel?.id;
      const messageTs = (body as any).message?.ts;

      // Update the original message to show result
      if (channel && messageTs) {
        await client.chat.update({
          token: this.botToken,
          channel,
          ts: messageTs,
          text: result,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `:white_check_mark: ${result}` },
          }],
        });
      }
    });

    this.app.action("reject_task", async ({ body, ack, client }) => {
      await ack();
      const action = (body as any).actions?.[0];
      const taskId = action?.value;
      if (!taskId) return;

      // Open a modal for feedback
      const triggerId = (body as any).trigger_id;
      if (triggerId) {
        await client.views.open({
          token: this.botToken,
          trigger_id: triggerId,
          view: {
            type: "modal",
            callback_id: "reject_feedback_modal",
            private_metadata: JSON.stringify({
              taskId,
              channel: (body as any).channel?.id,
              messageTs: (body as any).message?.ts,
            }),
            title: { type: "plain_text", text: "Reject Task" },
            submit: { type: "plain_text", text: "Reject" },
            close: { type: "plain_text", text: "Cancel" },
            blocks: [{
              type: "input",
              block_id: "feedback_block",
              label: { type: "plain_text", text: "Feedback" },
              element: {
                type: "plain_text_input",
                action_id: "feedback_input",
                multiline: true,
                placeholder: { type: "plain_text", text: "What needs to change?" },
              },
            }],
          },
        });
      }
    });

    // Handle reject modal submission
    this.app.view("reject_feedback_modal", async ({ ack, view, client }) => {
      await ack();
      const meta = JSON.parse(view.private_metadata || "{}");
      const feedback = view.state.values.feedback_block?.feedback_input?.value
        ?? "Rejected via Slack — needs changes.";

      const result = await this.executeReviewAction("reject", meta.taskId, feedback);

      // Update the original message
      if (meta.channel && meta.messageTs) {
        await client.chat.update({
          token: this.botToken,
          channel: meta.channel,
          ts: meta.messageTs,
          text: result,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `:x: ${result}` },
          }],
        });
      }
    });

    // Build button handler — spawns Claude Code to build a queued finding
    this.app.action("build_task", async ({ body, ack, client }) => {
      await ack();
      const action = (body as any).actions?.[0];
      const findingId = action?.value;
      const channel = (body as any).channel?.id;
      const messageTs = (body as any).message?.ts;
      if (!findingId) return;

      // Look up DB task for this finding
      const db = getDb();
      const dbTasks = await db
        .select()
        .from(tasks)
        .where(sql`${tasks.metadata}->>'findingId' = ${findingId} AND ${tasks.status} = 'pending'`)
        .limit(1);
      const task = dbTasks[0];
      if (!task) {
        log.warn({ findingId }, "build_task: no pending DB task found");
        return;
      }

      // Mark DB task as in_progress
      await db.update(tasks).set({
        status: "in_progress",
        updatedAt: new Date(),
      }).where(eq(tasks.id, task.id));

      // Update Slack message to show building status
      if (channel && messageTs) {
        await client.chat.update({
          token: this.botToken,
          channel,
          ts: messageTs,
          text: `Building: ${task.title}`,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `:hammer_and_wrench: *Building* — ${task.title}\nClaude Code session spawned.` },
          }],
        });
      }

      // Spawn Claude Code session to build it
      const buildPrompt = [
        `Read data/inbox/tasks.md. Find the task with finding ID "${findingId}".`,
        `Build it end-to-end: scaffold, code, test locally, deploy, verify health,`,
        `set up monetization if applicable. When done, mark it as [x] in the inbox`,
        `and update brain.md with the new deployment.`,
      ].join(" ");

      log.info({ findingId, taskId: task.id }, "Spawning Claude Code build session");

      // Fire and forget — CC runs async
      this.handleClaudeCode(buildPrompt, channel ?? "build").then(async (result) => {
        // After CC finishes, send completion message
        try {
          if (channel) {
            await this.sendMessage(
              `:white_check_mark: Build complete for *${task.title}*\n${result.slice(0, 500)}`,
              channel,
            );
          }
        } catch (e) {
          log.warn({ error: String(e) }, "Failed to send build completion message");
        }
      }).catch((err) => {
        log.error({ error: String(err), findingId }, "Claude Code build session failed");
      });
    });

    // Skip button handler — marks task as skipped
    this.app.action("skip_task", async ({ body, ack, client }) => {
      await ack();
      const action = (body as any).actions?.[0];
      const findingId = action?.value;
      const channel = (body as any).channel?.id;
      const messageTs = (body as any).message?.ts;
      if (!findingId) return;

      // Mark DB task as failed (skipped)
      const db = getDb();
      const dbTasks = await db
        .select()
        .from(tasks)
        .where(sql`${tasks.metadata}->>'findingId' = ${findingId} AND ${tasks.status} = 'pending'`)
        .limit(1);
      const task = dbTasks[0];
      if (!task) {
        log.warn({ findingId }, "skip_task: no pending DB task found");
        return;
      }

      await db.update(tasks).set({
        status: "failed",
        updatedAt: new Date(),
        result: { skipped: true },
      }).where(eq(tasks.id, task.id));

      // Update inbox: change - [ ] to - [-] for this finding
      await this.updateInboxStatus(findingId, "skip");

      // Update Slack message
      if (channel && messageTs) {
        await client.chat.update({
          token: this.botToken,
          channel,
          ts: messageTs,
          text: `Skipped: ${task.title}`,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `:fast_forward: *Skipped* — ${task.title}` },
          }],
        });
      }
      log.info({ findingId, title: task.title }, "Task skipped via queue button");
    });

    // Listen for all messages (DMs + channels)
    this.app.message(async ({ message, say }) => {
      if (message.subtype) return;
      if (!("text" in message) || !message.text) return;

      const text = message.text;
      const senderId = ("user" in message ? message.user : undefined) ?? "unknown";
      const conversationId = ("channel" in message ? message.channel : undefined) ?? "unknown";

      if (senderId === this.botUserId) return;

      log.info({ from: senderId, text: text.substring(0, 50) }, "Slack message received");

      // Handle approve/reject commands
      const reviewResult = await this.handleReviewCommand(text.trim());
      if (reviewResult) {
        await say(reviewResult);
        return;
      }

      // Handle cc: reset — clear Claude Code session
      if (text.trim().match(/^(?:\/cc|cc:)\s*reset$/i)) {
        this.ccSessions.delete(conversationId);
        await say("Claude Code session reset.");
        return;
      }

      // Handle lulz: queue — show pending build queue on demand
      // Strip invisible Unicode chars that Slack may inject (ZWSP, ZWNJ, ZWJ, BOM, NBSP)
      const cleanText = text.trim().replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, '').replace(/\s+$/, '');
      if (cleanText.match(/^lulz:\s*queue$/i)) {
        try {
          const queueBlocks = await this.buildQueueMessage();
          if (queueBlocks) {
            await say({ text: "Build Queue", blocks: queueBlocks });
          } else {
            await say("Build queue is empty — no pending tasks.");
          }
        } catch (error) {
          log.error({ error: String(error) }, "Failed to show queue");
          await say("Error fetching build queue.");
        }
        return;
      }

      // Handle lulz: prefix — route to orchestrator (Sonnet, paid API)
      const lulzPrefix = text.match(/^lulz:\s+([\s\S]+)/i);
      if (lulzPrefix) {
        if (this.messageHandler) {
          try {
            const input: AgentInput = {
              source: "slack",
              text: lulzPrefix[1]!,
              senderId,
              senderName: senderId,
              conversationId,
            };
            const response = await this.messageHandler(input);
            await say(response);
          } catch (error) {
            log.error({ error: String(error) }, "Failed to handle orchestrator message");
            await say("Lulzasaur encountered an error.");
          }
        }
        return;
      }

      // Handle <agent>: prefix — route to specific agent by name
      const agentPrefix = text.match(/^(marketing|researcher|deep-researcher|sysops|coder|worker):\s+([\s\S]+)/i);
      if (agentPrefix) {
        const agentName = agentPrefix[1]!.toLowerCase();
        const agentText = agentPrefix[2]!;
        try {
          const targetAgent = await this.findAgentByName(agentName);
          if (targetAgent) {
            await say(`_Routing to ${agentName} agent..._`);
            const { runAgentTurn } = await import("../../agent/runtime.js");
            const result = await runAgentTurn(targetAgent.id, agentText);
            const chunks = this.splitMessage(result.response);
            for (const chunk of chunks) {
              await say(chunk);
            }
          } else {
            await say(`Agent "${agentName}" not found or not running.`);
          }
        } catch (error) {
          log.error({ error: String(error), agentName }, "Failed to route to agent");
          await say(`Error reaching ${agentName} agent.`);
        }
        return;
      }

      // Channel-based routing: if message is in an agent's dedicated channel, route to that agent
      if (await this.routeToChannelAgent(conversationId, text, senderId, say)) return;

      // Default: route to Claude Code (OAuth, free)
      await say("_Claude Code is thinking..._");
      try {
        const ccResponse = await this.handleClaudeCode(text, conversationId);
        const chunks = this.splitMessage(ccResponse);
        for (const chunk of chunks) {
          await say(chunk);
        }
      } catch (error) {
        log.error({ error: String(error) }, "Failed to handle Claude Code request");
        await say("Claude Code encountered an error.");
      }
    });

    // Listen for @mentions
    this.app.event("app_mention", async ({ event, say }) => {
      const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!text) return;

      const senderId = event.user ?? "unknown";
      const conversationId = event.channel ?? "unknown";

      const reviewResult = await this.handleReviewCommand(text.trim());
      if (reviewResult) {
        await say(reviewResult);
        return;
      }

      // Handle cc: reset — clear Claude Code session
      if (text.trim().match(/^(?:\/cc|cc:)\s*reset$/i)) {
        this.ccSessions.delete(conversationId);
        await say("Claude Code session reset.");
        return;
      }

      // Handle lulz: queue — show pending build queue on demand
      // Strip invisible Unicode chars that Slack may inject (ZWSP, ZWNJ, ZWJ, BOM, NBSP)
      const cleanMentionText = text.trim().replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, '').replace(/\s+$/, '');
      if (cleanMentionText.match(/^lulz:\s*queue$/i)) {
        try {
          const queueBlocks = await this.buildQueueMessage();
          if (queueBlocks) {
            await say({ text: "Build Queue", blocks: queueBlocks });
          } else {
            await say("Build queue is empty — no pending tasks.");
          }
        } catch (error) {
          log.error({ error: String(error) }, "Failed to show queue");
          await say("Error fetching build queue.");
        }
        return;
      }

      // Handle lulz: prefix — route to orchestrator
      const lulzPrefix = text.match(/^lulz:\s+([\s\S]+)/i);
      if (lulzPrefix) {
        if (this.messageHandler) {
          try {
            const input: AgentInput = {
              source: "slack",
              text: lulzPrefix[1]!,
              senderId,
              senderName: senderId,
              conversationId,
            };
            const response = await this.messageHandler(input);
            await say(response);
          } catch (error) {
            log.error({ error: String(error) }, "Failed to handle orchestrator mention");
            await say("Lulzasaur encountered an error.");
          }
        }
        return;
      }

      // Handle <agent>: prefix — route to specific agent by name
      const agentPrefix = text.match(/^(marketing|researcher|deep-researcher|sysops|coder|worker):\s+([\s\S]+)/i);
      if (agentPrefix) {
        const agentName = agentPrefix[1]!.toLowerCase();
        const agentText = agentPrefix[2]!;
        try {
          const targetAgent = await this.findAgentByName(agentName);
          if (targetAgent) {
            await say(`_Routing to ${agentName} agent..._`);
            const { runAgentTurn } = await import("../../agent/runtime.js");
            const result = await runAgentTurn(targetAgent.id, agentText);
            const chunks = this.splitMessage(result.response);
            for (const chunk of chunks) {
              await say(chunk);
            }
          } else {
            await say(`Agent "${agentName}" not found or not running.`);
          }
        } catch (error) {
          log.error({ error: String(error), agentName }, "Failed to route to agent");
          await say(`Error reaching ${agentName} agent.`);
        }
        return;
      }

      // Channel-based routing: if mention is in an agent's dedicated channel, route to that agent
      if (await this.routeToChannelAgent(conversationId, text, senderId, say)) return;

      // Default: route to Claude Code (OAuth, free)
      await say("_Claude Code is thinking..._");
      try {
        const ccResponse = await this.handleClaudeCode(text, conversationId);
        const chunks = this.splitMessage(ccResponse);
        for (const chunk of chunks) {
          await say(chunk);
        }
      } catch (error) {
        log.error({ error: String(error) }, "Failed to handle Claude Code mention");
        await say("Claude Code encountered an error.");
      }
    });

    await this.app.start();

    try {
      const authResult = await this.app.client.auth.test({ token: this.botToken });
      this.botUserId = (authResult.user_id as string) ?? null;
      log.info({ botUserId: this.botUserId }, "Slack connected");
    } catch (e) {
      log.warn({ error: String(e) }, "Could not determine bot user ID");
    }

    this.isConnected = true;
    this.registerAsNotifier();
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.unregisterAsNotifier();
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    _slackAdapter = null;
    log.info("Slack adapter stopped");
  }

  /** Send a message to a channel. If no channel specified, broadcasts to allowed channels. */
  async sendMessage(text: string, channel?: string, blocks?: any[]): Promise<void> {
    if (!this.app) throw new Error("Slack not connected");

    if (blocks && !channel) {
      await this.broadcastBlocks(text, blocks);
    } else if (channel) {
      await this.app.client.chat.postMessage({
        token: this.botToken,
        channel,
        text,
        ...(blocks ? { blocks } : {}),
      });
    } else {
      await this.broadcastToUser(text);
    }
  }

  onMessage(handler: (input: AgentInput) => Promise<string>): void {
    this.messageHandler = handler;
  }

  getApp(): App | null {
    return this.app;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  private async handleReviewCommand(text: string): Promise<string | null> {
    const lower = text.toLowerCase();
    const actions = ["approve", "reject"] as const;

    for (const action of actions) {
      if (!lower.startsWith(action + " ")) continue;

      const rest = text.substring(action.length + 1).trim();
      if (!rest) return null;

      const spaceIdx = rest.indexOf(" ");
      const prefix = spaceIdx > 0 ? rest.substring(0, spaceIdx) : rest;
      const feedback = spaceIdx > 0 ? rest.substring(spaceIdx + 1).trim() : undefined;

      return this.executeReviewAction(action, prefix, feedback);
    }

    return null;
  }

  private registerAsNotifier(): void {
    if (this.notifierRegistered) return;
    this.notifierRegistered = true;

    this.reviewHandler = (review) => {
      const blocks: any[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "Review Requested", emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${review.title}*\n${review.summary}`,
          },
        },
      ];
      if (review.evidence) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `_Evidence: ${review.evidence.substring(0, 500)}_`,
          },
        });
      }
      blocks.push(
        { type: "divider" },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve", emoji: true },
              style: "primary",
              action_id: "approve_task",
              value: review.taskId,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Reject", emoji: true },
              style: "danger",
              action_id: "reject_task",
              value: review.taskId,
            },
          ],
        },
      );
      const fallbackText = `Review: ${review.title} — approve ${review.taskId.substring(0, 8)} / reject ${review.taskId.substring(0, 8)}`;
      // Route to the requesting agent's channel if possible
      if (review.agentId) {
        this.sendMessageForAgent(review.agentId, fallbackText, blocks).catch((e) =>
          log.warn({ error: String(e) }, "Failed to send review via Slack"),
        );
      } else {
        this.broadcastBlocks(fallbackText, blocks).catch((e) =>
          log.warn({ error: String(e) }, "Failed to send review via Slack"),
        );
      }
    };

    onReviewRequested(this.reviewHandler);
  }

  private unregisterAsNotifier(): void {
    if (!this.notifierRegistered) return;
    if (this.reviewHandler) {
      offReviewRequested(this.reviewHandler);
      this.reviewHandler = null;
    }
    this.notifierRegistered = false;
  }

  /** Route a message to the agent that owns this channel. Returns true if handled. */
  private async routeToChannelAgent(
    channelId: string,
    text: string,
    senderId: string,
    say: (msg: string) => Promise<any>,
  ): Promise<boolean> {
    const agentName = this.channelAgentMap.get(channelId);
    if (!agentName) return false;

    try {
      const targetAgent = await this.findAgentByName(agentName);
      if (!targetAgent) {
        await say(`Agent "${agentName}" not found or not running.`);
        return true;
      }
      await say(`_Routing to ${agentName}..._`);
      const { runAgentTurn } = await import("../../agent/runtime.js");
      const result = await runAgentTurn(targetAgent.id, text);
      const chunks = this.splitMessage(result.response);
      for (const chunk of chunks) {
        await say(chunk);
      }
    } catch (error) {
      log.error({ error: String(error), agentName, channelId }, "Failed to route to channel agent");
      await say(`Error reaching ${agentName} agent.`);
    }
    return true;
  }

  /** Find an agent by soul name (e.g. "marketing", "researcher") */
  private async findAgentByName(name: string) {
    const db = getDb();
    const results = await db
      .select()
      .from(agents)
      .where(eq(agents.name, name));
    return results.find((a) => a.status !== "terminated") ?? null;
  }

  /** Append a line to data/inbox/tasks.md under the BUILD section */
  private async appendToInbox(line: string): Promise<void> {
    const config = getConfig();
    const inboxDir = join(config.MEMORY_DIR, "inbox");
    const inboxPath = join(inboxDir, "tasks.md");

    try {
      await mkdir(inboxDir, { recursive: true });
    } catch {}

    let content: string;
    try {
      content = await readFile(inboxPath, "utf-8");
    } catch {
      content = "# Lulzasaur Task Inbox\n\n## BUILD — Approved Findings\n\n";
    }

    // Insert under BUILD section, or append at end
    const buildHeader = "## BUILD";
    const buildIdx = content.indexOf(buildHeader);
    if (buildIdx >= 0) {
      // Find the next section header after BUILD
      const afterBuild = content.indexOf("\n## ", buildIdx + buildHeader.length);
      const insertPos = afterBuild >= 0 ? afterBuild : content.length;
      content = content.slice(0, insertPos).trimEnd() + "\n" + line + "\n" + content.slice(insertPos);
    } else {
      content = content.trimEnd() + "\n\n## BUILD — Approved Findings\n\n" + line + "\n";
    }

    await writeFile(inboxPath, content, "utf-8");
    log.info("Appended finding to inbox");
  }

  /** Build Block Kit message for the pending build queue. Returns null if queue is empty. */
  private async buildQueueMessage(): Promise<any[] | null> {
    const db = getDb();
    const pendingTasks = await db
      .select()
      .from(tasks)
      .where(sql`${tasks.metadata}->>'findingId' IS NOT NULL AND ${tasks.status} = 'pending'`);

    if (pendingTasks.length === 0) return null;

    const confidenceEmoji: Record<string, string> = {
      "LOW": ":small_orange_diamond:",
      "MEDIUM": ":large_orange_diamond:",
      "MEDIUM-HIGH": ":large_blue_diamond:",
      "HIGH": ":white_check_mark:",
    };

    const blocks: any[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `Build Queue — ${pendingTasks.length} pending`, emoji: true },
      },
    ];

    for (const task of pendingTasks) {
      const meta = (task.metadata ?? {}) as Record<string, unknown>;
      const confidence = (meta.confidence as string) ?? "MEDIUM";
      const findingId = meta.findingId as string;
      const emoji = confidenceEmoji[confidence] ?? ":large_orange_diamond:";

      blocks.push(
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${task.title}* — ${emoji} ${confidence}` },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: task.description?.slice(0, 100) ?? "" }],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Build", emoji: true },
              style: "primary",
              action_id: "build_task",
              value: findingId,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Skip", emoji: true },
              style: "danger",
              action_id: "skip_task",
              value: findingId,
            },
          ],
        },
      );
    }

    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "Click *Build* to start a Claude Code session, or *Skip* to dismiss." }],
      },
    );

    return blocks;
  }

  /** Update inbox task status for a finding. mode: "complete" marks [x], "skip" marks [-] */
  private async updateInboxStatus(findingId: string, mode: "complete" | "skip"): Promise<void> {
    const config = getConfig();
    const inboxPath = join(config.MEMORY_DIR, "inbox", "tasks.md");

    try {
      let content = await readFile(inboxPath, "utf-8");
      const marker = `(${findingId})`;
      if (content.includes(marker)) {
        const replacement = mode === "complete" ? "- [x]" : "- [-]";
        // Replace the checkbox on the line containing this findingId
        content = content.replace(
          new RegExp(`^- \\[[ ]\\] (.*\\(${findingId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\).*)$`, "m"),
          `${replacement} $1`,
        );
        await writeFile(inboxPath, content, "utf-8");
        log.info({ findingId, mode }, "Updated inbox status");
      }
    } catch (err) {
      log.warn({ error: String(err), findingId }, "Failed to update inbox status");
    }
  }

  private async handleClaudeCode(prompt: string, channel: string): Promise<string> {
    const { spawn } = await import("node:child_process");
    const claudeBin = process.env.CLAUDE_BIN ?? "claude";
    const config = getConfig();
    const workspaceDir = join(config.MEMORY_DIR, "workspace");

    const args = ["--print", "--output-format", "json", "--dangerously-skip-permissions"];

    // Resume existing session for multi-turn
    const existingSession = this.ccSessions.get(channel);
    if (existingSession) {
      args.push("--resume", existingSession);
    }

    args.push(prompt);

    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.CLAUDECODE;

    const { mkdirSync } = await import("node:fs");
    mkdirSync(workspaceDir, { recursive: true });

    return new Promise((resolve) => {
      let stdout = "";
      const child = spawn(claudeBin, args, {
        cwd: workspaceDir,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });

      child.on("close", (code) => {
        try {
          const result = JSON.parse(stdout);
          // Save session for multi-turn
          if (result.session_id) {
            this.ccSessions.set(channel, result.session_id);
          }
          const text = result.result ?? result.response ?? "(empty)";
          resolve(text.slice(0, 3900));
        } catch {
          resolve(stdout.slice(0, 3900) || `Claude Code error (exit ${code})`);
        }
      });

      child.on("error", (err) => {
        resolve(`Failed to start Claude Code: ${err.message}`);
      });
    });
  }

  private splitMessage(text: string, maxLen = 3900): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline near the limit
      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt < maxLen * 0.5) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    return chunks;
  }

  /** Execute an approve/reject action on a task by ID. Used by both buttons and text commands. */
  private async executeReviewAction(action: "approve" | "reject", taskIdOrPrefix: string, feedback?: string): Promise<string> {
    try {
      const db = getDb();
      const allTasks = await db.select().from(tasks);
      const task = allTasks.find((t) => (t.id === taskIdOrPrefix || t.id.startsWith(taskIdOrPrefix)) && (t.status === "completed" || t.status === "in_progress"));

      if (!task) return `No task matching "${taskIdOrPrefix.substring(0, 8)}".`;

      if (action === "approve") {
        await db.update(tasks).set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(tasks.id, task.id));

        if (task.assignedTo) {
          await db.insert(messages).values({
            type: "system",
            toAgentId: task.assignedTo,
            content: { action: "approved", message: "User approved your work via Slack." },
          });
        }
        return `Approved: ${task.title}`;
      } else {
        const fb = feedback ?? "Rejected via Slack — needs changes.";
        await db.update(tasks).set({
          status: "in_progress",
          updatedAt: new Date(),
        }).where(eq(tasks.id, task.id));

        if (task.assignedTo) {
          await db.insert(messages).values({
            type: "system",
            toAgentId: task.assignedTo,
            content: { action: "rejected", feedback: fb },
          });
        }
        return `Rejected: ${task.title}\nFeedback: ${fb}`;
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** Resolve an agent UUID to its configured Slack channel ID. */
  async resolveAgentChannel(agentId: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.agentChannelCache.get(agentId);
    if (cached) return cached;

    try {
      const db = getDb();
      const results = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)).limit(1);
      const agentName = results[0]?.name;
      if (agentName) {
        const channelId = this.agentChannelMap.get(agentName);
        if (channelId) {
          this.agentChannelCache.set(agentId, channelId);
          return channelId;
        }
      }
    } catch (e) {
      log.warn({ agentId, error: String(e) }, "Failed to resolve agent channel");
    }
    return undefined;
  }

  /** Send a message routed to the agent's dedicated channel. Falls back to defaultChannel, then broadcastToUser. */
  async sendMessageForAgent(agentId: string, text: string, blocks?: any[]): Promise<void> {
    const channel = await this.resolveAgentChannel(agentId) ?? this.defaultChannel;
    if (channel) {
      await this.sendMessage(text, channel, blocks);
    } else {
      await this.broadcastToUser(text);
    }
  }

  /** Broadcast a Block Kit message to the default outbound channel. */
  private async broadcastBlocks(fallbackText: string, blocks: any[]): Promise<void> {
    if (!this.app || !this.isConnected) return;

    const channel = this.defaultChannel;
    if (!channel) return;

    try {
      await this.app.client.chat.postMessage({
        token: this.botToken,
        channel,
        text: fallbackText,
        blocks,
      });
    } catch (e) {
      log.warn({ channel, error: String(e) }, "Failed to send Slack blocks broadcast");
    }
  }

  private async broadcastToUser(text: string): Promise<void> {
    if (!this.app || !this.isConnected) return;

    const channel = this.defaultChannel;
    if (!channel) return;

    try {
      await this.app.client.chat.postMessage({
        token: this.botToken,
        channel,
        text,
      });
    } catch (e) {
      log.warn({ channel, error: String(e) }, "Failed to send Slack broadcast");
    }
  }
}
