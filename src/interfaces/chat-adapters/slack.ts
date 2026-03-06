import { App, type LogLevel } from "@slack/bolt";
import type { ChatAdapter } from "./adapter-types.js";
import type { AgentInput } from "../../core/types.js";
import { createChildLogger } from "../../utils/logger.js";
import { onReviewRequested, offReviewRequested } from "../../tools/built-in/request-review.js";
import { getDb } from "../../db/client.js";
import { tasks, messages, agents } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { getProjectIdFromChannel } from "../../integrations/slack-channels.js";

const log = createChildLogger("slack");

export class SlackAdapter implements ChatAdapter {
  name = "slack";
  private app: App | null = null;
  private messageHandler: ((input: AgentInput) => Promise<string>) | null = null;
  private projectMessageHandler: ((projectId: string, input: AgentInput) => Promise<string>) | null = null;
  private botToken: string;
  private signingSecret: string;
  private appToken: string;
  private allowedChannels: string[];
  private botUserId: string | null = null;
  private reviewHandler: ((review: any) => void) | null = null;
  private notifierRegistered = false;
  private isConnected = false;

  constructor(options: {
    botToken: string;
    signingSecret: string;
    appToken: string;
    allowedChannels?: string[];
  }) {
    this.botToken = options.botToken;
    this.signingSecret = options.signingSecret;
    this.appToken = options.appToken;
    this.allowedChannels = options.allowedChannels ?? [];
  }

  async start(): Promise<void> {
    this.app = new App({
      token: this.botToken,
      signingSecret: this.signingSecret,
      appToken: this.appToken,
      socketMode: true,
      logLevel: "ERROR" as LogLevel,
    });

    // Listen for all messages (DMs + channels where bot is added)
    this.app.message(async ({ message, say }) => {
      // Skip bot messages and message_changed events
      if (message.subtype) return;
      if (!("text" in message) || !message.text) return;

      const text = message.text;
      const senderId = ("user" in message ? message.user : undefined) ?? "unknown";
      const conversationId = ("channel" in message ? message.channel : undefined) ?? "unknown";

      // Skip own messages
      if (senderId === this.botUserId) return;

      log.info({ from: senderId, text: text.substring(0, 50) }, "Slack message received");

      // Handle approve/reject commands directly
      const reviewResult = await this.handleReviewCommand(text.trim());
      if (reviewResult) {
        await say(reviewResult);
        return;
      }

      // Route: check if channel maps to a project
      await this.routeMessage(conversationId, text, senderId, (t: string) => say(t));
    });

    // Listen for @mentions in channels
    this.app.event("app_mention", async ({ event, say }) => {
      const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim(); // Strip mention
      if (!text) return;

      const senderId = event.user ?? "unknown";
      const conversationId = event.channel ?? "unknown";

      log.info({ from: senderId, text: text.substring(0, 50) }, "Slack mention received");

      // Handle approve/reject/reply/dismiss commands
      const reviewResult = await this.handleReviewCommand(text.trim());
      if (reviewResult) {
        await say(reviewResult);
        return;
      }

      // Route: check if channel maps to a project
      await this.routeMessage(conversationId, text, senderId, (t: string) => say(t));
    });

    await this.app.start();

    // Get bot user ID to filter own messages
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
    log.info("Slack adapter stopped");
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.app) throw new Error("Slack not connected");
    await this.app.client.chat.postMessage({
      token: this.botToken,
      channel: to,
      text,
    });
    log.debug({ to, textLength: text.length }, "Slack message sent");
  }

  onMessage(handler: (input: AgentInput) => Promise<string>): void {
    this.messageHandler = handler;
  }

  /**
   * Register a handler for messages in project channels.
   * Called with the projectId so the caller can route to the right orchestrator.
   */
  onProjectMessage(handler: (projectId: string, input: AgentInput) => Promise<string>): void {
    this.projectMessageHandler = handler;
  }

  /** Route message to the correct handler based on channel → project mapping. */
  private async routeMessage(
    channelId: string,
    text: string,
    senderId: string,
    say: (text: string) => Promise<unknown>,
  ): Promise<void> {
    const input: AgentInput = {
      source: "slack",
      text,
      senderId,
      senderName: senderId,
      conversationId: channelId,
    };

    // Check if this channel maps to a project
    const projectId = getProjectIdFromChannel(channelId);

    if (projectId && this.projectMessageHandler) {
      try {
        const response = await this.projectMessageHandler(projectId, input);
        await say(response);
      } catch (error) {
        log.error({ error: String(error), projectId }, "Failed to handle project Slack message");
        await say("Sorry, I encountered an error processing your message.");
      }
      return;
    }

    // Default: route to main orchestrator
    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(input);
        await say(response);
      } catch (error) {
        log.error({ error: String(error) }, "Failed to handle Slack message");
        await say("Sorry, I encountered an error processing your message.");
      }
    }
  }

  /** Expose the internal Bolt App for channel management and other integrations. */
  getApp(): App | null {
    return this.app;
  }

  /** Get the bot token. */
  getBotToken(): string {
    return this.botToken;
  }

  /** Whether Slack is currently connected. */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Handle review commands: "approve <id>", "reject <id> <feedback>".
   */
  private async handleReviewCommand(text: string): Promise<string | null> {
    const lower = text.toLowerCase();
    const actions = ["approve", "reject"];

    for (const action of actions) {
      if (!lower.startsWith(action + " ")) continue;

      const rest = text.substring(action.length + 1).trim();
      if (!rest) return null;

      const spaceIdx = rest.indexOf(" ");
      const prefix = spaceIdx > 0 ? rest.substring(0, spaceIdx) : rest;
      const message = spaceIdx > 0 ? rest.substring(spaceIdx + 1).trim() : undefined;

      try {
        const db = getDb();
        const allReviewPending = await db
          .select()
          .from(tasks)
          .where(eq(tasks.status, "review_pending" as any));
        const task = allReviewPending.find((t) => t.id.startsWith(prefix));

        if (!task) return `No review-pending task matching "${prefix}".`;

        if (action === "approve") {
          await db.update(tasks).set({
            status: "completed",
            verificationStatus: "verified",
            verificationNotes: "Approved by user via Slack",
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(tasks.id, task.id));

          if (task.assignedTo) {
            await db.insert(messages).values({
              type: "task_verification",
              toAgentId: task.assignedTo,
              taskId: task.id,
              content: { action: "approved", message: "User approved your work via Slack." },
            });
          }
          return `Approved: ${task.title}`;
        } else {
          const feedback = message ?? "Rejected via Slack — needs changes.";
          await db.update(tasks).set({
            status: "in_progress",
            verificationStatus: "rejected",
            verificationNotes: feedback,
            updatedAt: new Date(),
          }).where(eq(tasks.id, task.id));

          if (task.assignedTo) {
            await db.insert(messages).values({
              type: "task_verification",
              toAgentId: task.assignedTo,
              taskId: task.id,
              content: { action: "rejected", feedback },
            });
          }
          return `Rejected: ${task.title}\nFeedback: ${feedback}`;
        }
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    return null;
  }

  private registerAsNotifier(): void {
    if (this.notifierRegistered) return;
    this.notifierRegistered = true;

    this.reviewHandler = (review) => {
      const lines = [
        `*Review Requested*`,
        ``,
        `*${review.title}*`,
        review.summary,
      ];
      if (review.evidence) {
        lines.push(``, `_Evidence: ${review.evidence.substring(0, 300)}_`);
      }
      lines.push(``, `Reply with \`approve ${review.taskId.substring(0, 8)}\` or \`reject ${review.taskId.substring(0, 8)} <feedback>\``);
      this.broadcastToUser(lines.join("\n")).catch((e) =>
        log.warn({ error: String(e) }, "Failed to send review request via Slack"),
      );
    };

    onReviewRequested(this.reviewHandler);

    log.info("Slack registered as notifier for reviews");
  }

  private unregisterAsNotifier(): void {
    if (!this.notifierRegistered) return;

    if (this.reviewHandler) {
      offReviewRequested(this.reviewHandler);
      this.reviewHandler = null;
    }

    this.notifierRegistered = false;
    log.debug("Slack unregistered as notifier");
  }

  /** Send a message to all allowed channels (the "user"). */
  private async broadcastToUser(text: string): Promise<void> {
    if (!this.app || !this.isConnected) {
      log.debug("Cannot broadcast - Slack not connected");
      return;
    }

    if (this.allowedChannels.length === 0) {
      log.debug("No allowed channels configured — cannot broadcast to user via Slack");
      return;
    }

    for (const channel of this.allowedChannels) {
      try {
        await this.app.client.chat.postMessage({
          token: this.botToken,
          channel: channel.trim(),
          text,
        });
        log.debug({ channel, textPreview: text.substring(0, 50) }, "Slack broadcast sent");
      } catch (e) {
        log.warn({ channel, error: String(e) }, "Failed to send Slack broadcast");
      }
    }
  }
}
