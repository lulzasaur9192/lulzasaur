import { config as loadDotenv } from "dotenv";
import { join } from "node:path";

// Load .env before anything else reads process.env
loadDotenv();

import { loadConfig } from "./config/index.js";
import { getDb, closeDb } from "./db/client.js";
import { agents, soulDefinitions, projects } from "./db/schema.js";
import { eq, ne, and } from "drizzle-orm";
import { syncSoulsFromDirectory } from "./core/soul.js";
import { syncProjectsFromDirectory, syncProjectSouls } from "./core/project.js";
import { createAgent, gcTerminatedAgents, terminateTemporaryAgents, syncAgentsFromSouls } from "./agent/registry.js";
import { initializeDefaultProviders } from "./llm/registry.js";
import { startScheduler, stopScheduler } from "./agent/scheduler.js";
import { handleInput } from "./interfaces/gateway.js";
import { startWebServer } from "./interfaces/web/server.js";
import {
  listAgentsCmd,
  listTasksCmd,
  heartbeatsLogCmd,
  conversationsCmd,
  messagesCmd,
  soulsCmd,
  cloneSoulCmd,
  goalsCmd,
  reviewsCmd,
  approveTaskCmd,
  rejectTaskCmd,
  inboxCmd,
  respondInboxCmd,
  setupReviewNotifications,
  printHelp,
} from "./interfaces/cli/commands.js";
import { SlackAdapter } from "./interfaces/chat-adapters/slack.js";
import { createChildLogger } from "./utils/logger.js";
import { getPendingCount } from "./inbox/user-inbox.js";
import { ensureProjectChannels, ensureSystemChannel, setSystemChannelId } from "./integrations/slack-channels.js";
import { setSlackRef } from "./integrations/slack-ref.js";

// Register all tools (side-effect imports)
import "./tools/index.js";

const log = createChildLogger("main");

export async function boot() {
  const config = loadConfig();

  // Initialize DB + push schema
  const db = getDb();
  const { execSync } = await import("node:child_process");
  try {
    execSync("npx drizzle-kit push --force", {
      cwd: import.meta.dirname ? join(import.meta.dirname, "..") : process.cwd(),
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
    });
  } catch (error) {
    log.error({ error: String(error) }, "Failed to push schema — ensure PostgreSQL is running");
    process.exit(1);
  }

  // Initialize LLM providers
  initializeDefaultProviders();

  // Sync soul definitions from YAML files
  const soulsDir = join(import.meta.dirname ? join(import.meta.dirname, "..") : process.cwd(), "souls");
  await syncSoulsFromDirectory(soulsDir);

  // Sync projects from modules/ directory
  const modulesDir = config.MODULES_DIR
    ?? join(import.meta.dirname ? join(import.meta.dirname, "..") : process.cwd(), "modules");
  await syncProjectsFromDirectory(modulesDir);
  await syncProjectSouls(modulesDir);

  // 1. GC: Delete terminated temporary agents and their data
  const gcCount = await gcTerminatedAgents();
  if (gcCount > 0) log.info({ count: gcCount }, "Garbage-collected temporary agents");

  // 2. Terminate stale temporary agents (non-persistent, still alive)
  await terminateTemporaryAgents();

  // 2.5. Reset stale "active" agents to "idle" — no agent can be running at boot
  const staleActive = await db
    .update(agents)
    .set({ status: "idle", updatedAt: new Date(), currentCheckpoint: null })
    .where(eq(agents.status, "active" as any))
    .returning({ id: agents.id, name: agents.name });
  if (staleActive.length > 0) {
    log.info({ agents: staleActive.map((a) => a.name) }, "Reset stale active agents to idle");
  }

  // 2.6. Sync agent settings (model, intervals, schedules) from soul definitions
  await syncAgentsFromSouls();

  // 3. Ensure all persistent souls have a running agent
  const persistentSouls = await db
    .select()
    .from(soulDefinitions)
    .where(eq(soulDefinitions.persistent, true));

  // Query ALL non-terminated agents (not just "idle") to avoid creating duplicates on restart
  const allAliveAgents = await db
    .select()
    .from(agents)
    .where(ne(agents.status, "terminated"));

  for (const soul of persistentSouls) {
    // For project souls, match on both name and projectId
    const existing = allAliveAgents.find((a) =>
      a.name === soul.name && (soul.projectId ? a.projectId === soul.projectId : !a.projectId),
    );
    if (!existing) {
      await createAgent({
        name: soul.name,
        soulName: soul.name,
        depth: soul.name === "main-orchestrator" ? 1 : 2,
        heartbeatIntervalSeconds: soul.heartbeatIntervalSeconds,
        projectId: soul.projectId ?? undefined,
      });
    }
  }

  // Resolve orchestrator ID (may have just been created above)
  const orchestrator =
    allAliveAgents.find((a) => a.name === "main-orchestrator") ??
    (await db.select().from(agents).where(eq(agents.name, "main-orchestrator"))).find((a) => a.status !== "terminated");
  const orchestratorId = orchestrator!.id;

  // Start heartbeat scheduler
  startScheduler();

  // Start web server
  startWebServer(config.WEB_PORT, config.WEB_HOST);

  // Start Slack adapter if tokens configured
  let slack: SlackAdapter | null = null;
  if (config.SLACK_BOT_TOKEN && config.SLACK_APP_TOKEN) {
    slack = new SlackAdapter({
      botToken: config.SLACK_BOT_TOKEN,
      signingSecret: config.SLACK_SIGNING_SECRET ?? "",
      appToken: config.SLACK_APP_TOKEN,
      allowedChannels: config.SLACK_ALLOWED_CHANNELS?.split(",") ?? [],
    });
    slack.onMessage(async (input) => {
      const result = await handleInput(orchestratorId, input);
      return result.response;
    });

    // Route project-channel messages to project orchestrators
    slack.onProjectMessage(async (projectId, input) => {
      // Find the project's orchestrator (an agent with name ending in "-orchestrator" in this project)
      const projectAgents = await db
        .select()
        .from(agents)
        .where(and(
          eq(agents.projectId, projectId),
          ne(agents.status, "terminated"),
        ));
      const projectOrch = projectAgents.find((a) => a.name.includes("orchestrator")) ?? projectAgents[0];

      if (projectOrch) {
        const result = await handleInput(projectOrch.id, input);
        return result.response;
      }
      // Fallback to main orchestrator
      const result = await handleInput(orchestratorId, input);
      return result.response;
    });

    await slack.start();

    // Register Slack ref for other modules
    if (slack.getApp()) {
      setSlackRef(slack.getApp()!, config.SLACK_BOT_TOKEN);
    }

    // Auto-create Slack channels for active projects
    if (slack.getApp()) {
      try {
        // Ensure system channel
        const sysId = await ensureSystemChannel(slack.getApp()!, config.SLACK_BOT_TOKEN, "lulzasaur");
        if (sysId) setSystemChannelId(sysId);

        // Ensure project channels
        const activeProjects = await db.select().from(projects).where(eq(projects.active, true));
        for (const project of activeProjects) {
          await ensureProjectChannels(slack.getApp()!, config.SLACK_BOT_TOKEN, {
            id: project.id,
            name: project.name,
            config: project.config ?? undefined,
          });
        }
        log.info({ projectCount: activeProjects.length }, "Slack channels initialized");
      } catch (e) {
        log.warn({ error: String(e) }, "Failed to initialize Slack channels");
      }
    }
  }

  // Register CLI as a review notification listener
  setupReviewNotifications();

  return { config, orchestratorId, slack, agents: allAliveAgents };
}

// ANSI codes
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";

function wrapText(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n" + indent);
}

async function main() {
  const { config, orchestratorId, agents: aliveAgents } = await boot();

  // Build dynamic provider/model summary from live agents
  const modelCounts = new Map<string, number>();
  for (const a of aliveAgents) {
    const key = `${a.provider ?? "anthropic"}/${a.model ?? "unknown"}`;
    modelCounts.set(key, (modelCounts.get(key) ?? 0) + 1);
  }
  const modelSummary = [...modelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key} (${count})`)
    .join(", ");

  console.log(`\n  ${BOLD}${CYAN}Lulzasaur${RESET} ${DIM}v0.1.0${RESET}`);
  console.log(`  ${DIM}Agents: ${aliveAgents.length} active${RESET}`);
  console.log(`  ${DIM}Models: ${modelSummary}${RESET}`);
  console.log(`  ${DIM}Web:    http://localhost:${config.WEB_PORT}${RESET}`);
  console.log(`  ${DIM}Type /help for commands${RESET}\n`);

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = async () => {
    try {
      const pending = await getPendingCount();
      if (pending > 0) {
        process.stdout.write(`${YELLOW}[${pending} pending]${RESET} ${GREEN}>${RESET} `);
      } else {
        process.stdout.write(`${GREEN}>${RESET} `);
      }
    } catch {
      process.stdout.write(`${GREEN}>${RESET} `);
    }
  };

  await prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      await prompt();
      return;
    }

    // Handle CLI commands (with or without "/" prefix for approve/reject)
    const normalizedInput = input.startsWith("/") ? input : (() => {
      const lower = input.toLowerCase();
      if (lower.startsWith("approve")) return "/approve" + input.substring(7);
      if (lower.startsWith("reject")) return "/reject" + input.substring(6);
      return input;
    })();

    if (normalizedInput.startsWith("/")) {
      const [cmd, ...args] = normalizedInput.split(" ");
      try {
        switch (cmd) {
          case "/agents":
            await listAgentsCmd();
            break;
          case "/tasks":
            await listTasksCmd();
            break;
          case "/heartbeats":
            await heartbeatsLogCmd();
            break;
          case "/conversations":
            await conversationsCmd(args[0]);
            break;
          case "/messages":
            await messagesCmd();
            break;
          case "/souls":
            await soulsCmd();
            break;
          case "/clone":
            await cloneSoulCmd(args);
            break;
          case "/goals":
            await goalsCmd(args[0]);
            break;
          case "/inbox":
            await inboxCmd();
            break;
          case "/respond":
            await respondInboxCmd(args);
            break;
          case "/reviews":
            await reviewsCmd();
            break;
          case "/approve":
            await approveTaskCmd(args);
            break;
          case "/reject":
            await rejectTaskCmd(args);
            break;
          case "/help":
            printHelp();
            break;
          case "/quit":
          case "/exit":
            rl.close();
            return;
          default:
            console.log(`  ${DIM}Unknown command: ${cmd}. Type /help for available commands.${RESET}`);
        }
      } catch (error) {
        console.error(`  ${YELLOW}Error: ${error instanceof Error ? error.message : String(error)}${RESET}`);
      }
      await prompt();
      return;
    }

    // Chat with orchestrator
    console.log(); // blank line before response

    // Thinking indicator
    const spinChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinIdx = 0;
    const spinner = setInterval(() => {
      process.stdout.write(`\r  ${DIM}${spinChars[spinIdx++ % spinChars.length]} Thinking...${RESET}`);
    }, 80);

    try {
      const startTime = Date.now();
      const result = await handleInput(orchestratorId, {
        source: "cli",
        text: input,
      });

      // Clear spinner
      clearInterval(spinner);
      process.stdout.write("\r\x1b[K"); // clear line

      // Format response cleanly
      const responseLines = result.response.split("\n");
      for (const line of responseLines) {
        console.log(`  ${line}`);
      }

      // Compact metadata
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const meta = [
        result.toolCalls.length > 0 ? `${result.toolCalls.length} tools` : null,
        `${(result.tokenUsage.totalTokens / 1000).toFixed(1)}k tokens`,
        `${elapsed}s`,
      ].filter(Boolean).join(" · ");
      console.log(`  ${DIM}${meta}${RESET}`);
    } catch (error) {
      clearInterval(spinner);
      process.stdout.write("\r\x1b[K");
      console.error(`  ${YELLOW}Error: ${error instanceof Error ? error.message : String(error)}${RESET}`);
    }

    console.log();
    await prompt();
  });

  rl.on("close", async () => {
    console.log(`\n  ${DIM}Shutting down...${RESET}`);
    stopScheduler();
    await closeDb();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
