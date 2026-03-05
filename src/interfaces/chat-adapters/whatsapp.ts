import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { ChatAdapter } from "./adapter-types.js";
import type { AgentInput } from "../../core/types.js";
import { createChildLogger } from "../../utils/logger.js";
import { onUserMessage, offUserMessage } from "../../tools/built-in/message-user.js";
import { onReviewRequested, offReviewRequested } from "../../tools/built-in/request-review.js";
import { getDb } from "../../db/client.js";
import { tasks, messages } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const log = createChildLogger("whatsapp");

export class WhatsAppAdapter implements ChatAdapter {
  name = "whatsapp";
  private sock: WASocket | null = null;
  private messageHandler: ((input: AgentInput) => Promise<string>) | null = null;
  private authDir: string;
  private allowedNumbers: string[];
  private selfJid: string | null = null;
  private userMessageHandler: ((msg: any) => void) | null = null;
  private reviewHandler: ((review: any) => void) | null = null;
  private isConnected = false;

  constructor(options: { authDir: string; allowedNumbers?: string[] }) {
    this.authDir = options.authDir;
    this.allowedNumbers = options.allowedNumbers ?? [];
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    // Create a no-op logger that satisfies baileys' pino-like interface
    const noop = () => {};
    const silentLogger: any = {
      level: "silent",
      trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
      child: () => silentLogger,
    };

    this.sock = makeWASocket({
      auth: state,
      browser: ["Lulzasaur", "Desktop", "1.0.0"],
      logger: silentLogger,
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        this.isConnected = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        
        // Unregister old handlers before reconnecting
        this.unregisterAsNotifier();
        
        // Clean up old socket to prevent stale references and event listener accumulation
        if (this.sock) {
          this.sock.end(undefined);
          this.sock = null;
        }
        
        if (statusCode !== DisconnectReason.loggedOut) {
          log.debug("Connection closed, reconnecting...");
          this.start();
        } else {
          log.error("WhatsApp logged out — need to re-link");
        }
      }

      if (connection === "open") {
        this.isConnected = true;
        this.selfJid = this.sock?.user?.id ?? null;
        log.info({ selfJid: this.selfJid }, "WhatsApp connected");
        this.registerAsNotifier();
      }
    });

    this.sock.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
      if (type !== "notify") return;

      for (const msg of msgs) {
        // Skip own messages
        if (msg.key.fromMe) continue;

        // Extract text
        const text =
          msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          msg.message?.imageMessage?.caption ??
          null;

        if (!text) continue;

        const senderJid = msg.key.remoteJid ?? "";
        const senderNumber = senderJid.replace("@s.whatsapp.net", "").replace("@lid", "");
        const pushName = msg.pushName ?? "Unknown";

        // Check allowlist (if configured)
        if (this.allowedNumbers.length > 0) {
          const allowed = this.allowedNumbers.some(
            (n) => senderNumber.endsWith(n.replace(/\D/g, "")),
          );
          if (!allowed) {
            log.debug({ sender: senderNumber }, "Message from non-allowed number, ignoring");
            continue;
          }
        }

        log.info({ from: pushName, text: text.substring(0, 50) }, "WhatsApp message received");

        // Handle approve/reject commands directly
        const reviewResult = await this.handleReviewCommand(text.trim());
        if (reviewResult) {
          await this.sock?.readMessages([msg.key]);
          await this.sendMessage(senderJid, reviewResult);
          continue;
        }

        if (this.messageHandler) {
          try {
            // Mark as read
            await this.sock?.readMessages([msg.key]);

            // Send composing indicator
            await this.sock?.sendPresenceUpdate("composing", senderJid);

            const response = await this.messageHandler({
              source: "whatsapp",
              text,
              senderId: senderNumber,
              senderName: pushName,
              conversationId: senderJid,
            });

            // Send response
            await this.sock?.sendPresenceUpdate("paused", senderJid);
            await this.sendMessage(senderJid, response);
          } catch (error) {
            log.error({ error: String(error) }, "Failed to handle WhatsApp message");
            await this.sendMessage(senderJid, "Sorry, I encountered an error processing your message.");
          }
        }
      }
    });
  }

  /** Handle "approve <id>" or "reject <id> <feedback>" messages. Returns response text or null. */
  private async handleReviewCommand(text: string): Promise<string | null> {
    const lower = text.toLowerCase();

    if (lower.startsWith("approve ")) {
      const prefix = text.substring(8).trim();
      if (!prefix) return null;

      try {
        const db = getDb();
        const allReviewPending = await db
          .select()
          .from(tasks)
          .where(eq(tasks.status, "review_pending" as any));
        const task = allReviewPending.find((t) => t.id.startsWith(prefix));

        if (!task) return `No review-pending task matching "${prefix}".`;

        await db.update(tasks).set({
          status: "completed",
          verificationStatus: "verified",
          verificationNotes: "Approved by user via WhatsApp",
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(tasks.id, task.id));

        if (task.assignedTo) {
          await db.insert(messages).values({
            type: "task_verification",
            toAgentId: task.assignedTo,
            taskId: task.id,
            content: { action: "approved", message: "User approved your work via WhatsApp." },
          });
        }

        return `✅ Approved: ${task.title}`;
      } catch (e) {
        return `Error approving task: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (lower.startsWith("reject ")) {
      const rest = text.substring(7).trim();
      const spaceIdx = rest.indexOf(" ");
      const prefix = spaceIdx > 0 ? rest.substring(0, spaceIdx) : rest;
      const feedback = spaceIdx > 0 ? rest.substring(spaceIdx + 1).trim() : "Rejected via WhatsApp — needs changes.";

      if (!prefix) return null;

      try {
        const db = getDb();
        const allReviewPending = await db
          .select()
          .from(tasks)
          .where(eq(tasks.status, "review_pending" as any));
        const task = allReviewPending.find((t) => t.id.startsWith(prefix));

        if (!task) return `No review-pending task matching "${prefix}".`;

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

        return `❌ Rejected: ${task.title}\nFeedback: ${feedback}`;
      } catch (e) {
        return `Error rejecting task: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    return null;
  }

  private notifierRegistered = false;


  private unregisterAsNotifier(): void {
    if (!this.notifierRegistered) return;
    
    if (this.userMessageHandler) {
      offUserMessage(this.userMessageHandler);
      this.userMessageHandler = null;
    }
    
    if (this.reviewHandler) {
      offReviewRequested(this.reviewHandler);
      this.reviewHandler = null;
    }
    
    this.notifierRegistered = false;
    log.debug("WhatsApp unregistered as notifier");
  }

  private registerAsNotifier(): void {
    if (this.notifierRegistered) return;
    this.notifierRegistered = true;

    const typeIcons: Record<string, string> = {
      proposal: "💡",
      update: "📊",
      question: "❓",
      alert: "🚨",
    };

    // Store handler references so we can unregister them later
    this.userMessageHandler = (msg) => {
      const icon = typeIcons[msg.type] ?? "💬";
      const text = `${icon} *${msg.agentName}* (${msg.type})\n\n${msg.message}`;
      this.broadcastToUser(text).catch((e) =>
        log.warn({ error: String(e) }, "Failed to send user message via WhatsApp"),
      );
    };

    this.reviewHandler = (review) => {
      const lines = [
        `📋 *Review Requested*`,
        ``,
        `*${review.title}*`,
        review.summary,
      ];
      if (review.evidence) {
        lines.push(``, `_Evidence: ${review.evidence.substring(0, 300)}_`);
      }
      lines.push(``, `Reply with "approve ${review.taskId.substring(0, 8)}" or "reject ${review.taskId.substring(0, 8)} <feedback>"`);
      this.broadcastToUser(lines.join("\n")).catch((e) =>
        log.warn({ error: String(e) }, "Failed to send review request via WhatsApp"),
      );
    };

    onUserMessage(this.userMessageHandler);
    onReviewRequested(this.reviewHandler);

    log.info("WhatsApp registered as notifier for agent messages + reviews");
  }

  /** Send a message to all allowed numbers (the "user"). */
  private async broadcastToUser(text: string): Promise<void> {
    const currentSock = this.sock;
    
    if (!currentSock || !this.isConnected) {
      log.debug({ hasSocket: !!currentSock, isConnected: this.isConnected }, 
        "Cannot broadcast - WhatsApp not connected");
      return;
    }

    const targets = this.allowedNumbers.length > 0
      ? this.allowedNumbers
      : [];

    if (targets.length === 0) {
      log.debug("No allowed numbers configured — cannot broadcast to user via WhatsApp");
      return;
    }

    for (const number of targets) {
      try {
        const jid = `${number.replace(/\D/g, "")}@s.whatsapp.net`;
        await currentSock.sendMessage(jid, { text });
        log.debug({ number, textPreview: text.substring(0, 50) }, "WhatsApp broadcast sent");
      } catch (e) {
        log.warn({ number, error: String(e) }, "Failed to send WhatsApp broadcast");
      }
    }
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.unregisterAsNotifier();
    this.sock?.end(undefined);
    this.sock = null;
    log.info("WhatsApp adapter stopped");
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp not connected");

    // Normalize JID
    const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`;

    await this.sock.sendMessage(jid, { text });
    log.debug({ to: jid, textLength: text.length }, "WhatsApp message sent");
  }

  onMessage(handler: (input: AgentInput) => Promise<string>): void {
    this.messageHandler = handler;
  }
}
