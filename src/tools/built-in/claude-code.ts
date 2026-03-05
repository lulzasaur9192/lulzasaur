import { spawn } from "node:child_process";
import { eq, and } from "drizzle-orm";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { claudeCodeStream } from "../../events/claude-code-stream.js";
import { getDb } from "../../db/client.js";
import { agentMemory } from "../../db/schema.js";

const log = createChildLogger("tool-claude-code");

// Resolve claude binary path at module load time
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

// Default timeout: 5 minutes (coding tasks can take a while)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

// Default budget cap per invocation
const DEFAULT_MAX_BUDGET_USD = 1.0;

// How often to write status summary to agent_memory (ms)
const STATUS_WRITE_INTERVAL_MS = 10_000;

interface ClaudeCodeInput {
  prompt: string;
  working_directory?: string;
  resume_session_id?: string;
  permission_mode?: "plan" | "default" | "bypassPermissions";
  allowed_tools?: string[];
  max_budget_usd?: number;
  timeout_ms?: number;
  model?: string;
  system_prompt?: string;
}

function buildArgs(params: ClaudeCodeInput): string[] {
  const args: string[] = [
    "--print",
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--max-budget-usd", String(params.max_budget_usd ?? DEFAULT_MAX_BUDGET_USD),
  ];

  // Resume an existing session (for iteration/follow-up)
  if (params.resume_session_id) {
    args.push("--resume", params.resume_session_id);
  }

  // Permission mode: "plan" makes Claude Code plan first without executing
  if (params.permission_mode) {
    args.push("--permission-mode", params.permission_mode);
  }

  if (params.allowed_tools && params.allowed_tools.length > 0) {
    args.push("--allowedTools", params.allowed_tools.join(","));
  }

  if (params.model) {
    args.push("--model", params.model);
  }

  if (params.system_prompt) {
    args.push("--append-system-prompt", params.system_prompt);
  }

  // The prompt goes last
  args.push(params.prompt);

  return args;
}

function parseOutput(stdout: string, durationMs: number): Record<string, unknown> {
  try {
    const result = JSON.parse(stdout);
    return {
      result: result.result ?? result.response ?? stdout.substring(0, 5000),
      cost_usd: result.cost_usd,
      num_turns: result.num_turns,
      session_id: result.session_id,
      duration_ms: durationMs,
      is_error: result.is_error ?? false,
    };
  } catch {
    return {
      result: stdout.substring(0, 5000),
      duration_ms: durationMs,
    };
  }
}

/** Upsert a compact status string into agent_memory (for agent self-checks) */
async function writeStatusToMemory(agentId: string, status: string): Promise<void> {
  try {
    const db = getDb();
    const ns = "claude_code";
    const key = "current_session_status";

    const existing = await db
      .select()
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.agentId, agentId),
          eq(agentMemory.namespace, ns),
          eq(agentMemory.key, key),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentMemory)
        .set({ value: status, updatedAt: new Date() })
        .where(eq(agentMemory.id, existing[0]!.id));
    } else {
      await db.insert(agentMemory).values({
        agentId,
        namespace: ns,
        key,
        value: status,
      });
    }
  } catch (e) {
    log.debug({ error: (e as Error).message }, "Failed to write status to memory");
  }
}

registerTool({
  name: "claude_code",
  description:
    "Delegate a coding task to Claude Code (Anthropic's AI coding agent). " +
    "Claude Code can read/edit files, run shell commands, search codebases, " +
    "run tests, and make complex multi-file changes. Use this for any coding " +
    "task instead of manual shell_exec + file_write. Give it a clear, specific " +
    "prompt describing what to build, fix, or change. " +
    "Returns a session_id — use resume_session_id to follow up, iterate, or fix issues.",
  capability: "claude_code",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "The coding task to perform. Be specific: what to change, where, and how to verify it works. " +
          "For follow-ups, describe what needs to change (e.g. 'the tests are failing because X, fix Y').",
      },
      working_directory: {
        type: "string",
        description: "Directory to run in (default: project root). Claude Code will have access to this directory.",
      },
      resume_session_id: {
        type: "string",
        description:
          "Resume a previous Claude Code session by its session_id. " +
          "Use this to iterate: review output, give feedback, fix errors. " +
          "Claude Code retains full context from the previous session.",
      },
      permission_mode: {
        type: "string",
        enum: ["plan", "default", "bypassPermissions"],
        description:
          "Controls Claude Code's execution mode. " +
          "'plan' = Claude Code researches and proposes a plan but does NOT execute (use for initial review). " +
          "'default' = normal execution with permission checks. " +
          "'bypassPermissions' = full autonomous execution (default when not specified, since we use --dangerously-skip-permissions).",
      },
      allowed_tools: {
        type: "array",
        items: { type: "string" },
        description: "Restrict Claude Code's tools (e.g. ['Read', 'Edit', 'Bash', 'Glob', 'Grep']). Default: all tools.",
      },
      max_budget_usd: {
        type: "number",
        description: "Maximum dollar amount for this invocation (default: $1.00)",
      },
      timeout_ms: {
        type: "number",
        description: "Timeout in milliseconds (default: 300000 = 5 min, max: 900000 = 15 min)",
      },
      model: {
        type: "string",
        description: "Override model (e.g. 'sonnet', 'opus', 'haiku'). Default: Claude Code's default.",
      },
      system_prompt: {
        type: "string",
        description: "Additional system prompt context to append (e.g. project conventions, constraints).",
      },
    },
    required: ["prompt"],
  },
  execute: async (callerAgentId: string, input: unknown) => {
    const params = input as ClaudeCodeInput;
    const startTime = Date.now();

    const args = buildArgs(params);
    const timeout = Math.min(params.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const cwd = params.working_directory ?? process.cwd();

    log.info(
      {
        prompt: params.prompt.substring(0, 100),
        cwd,
        timeout,
        resuming: !!params.resume_session_id,
      },
      "Invoking Claude Code",
    );

    // Emit start event to dashboard
    claudeCodeStream.emitStream({
      agentId: callerAgentId,
      type: "start",
      text: params.prompt.substring(0, 200),
      timestamp: Date.now(),
    });

    await writeStatusToMemory(callerAgentId, "running | started");

    return new Promise((resolve) => {
      const child = spawn(CLAUDE_BIN, args, {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      // Track recent lines for status summary
      const recentLines: string[] = [];
      let lastStatusWrite = Date.now();

      // Timeout handling
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
      }, timeout);

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;

        // Stream each line to dashboard via SSE side-channel
        const lines = text.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          claudeCodeStream.emitStream({
            agentId: callerAgentId,
            type: "output",
            text: line,
            timestamp: Date.now(),
          });

          // Keep a small ring buffer for status
          recentLines.push(line.substring(0, 150));
          if (recentLines.length > 5) recentLines.shift();
        }

        // Periodically write compact status to agent_memory
        const now = Date.now();
        if (now - lastStatusWrite >= STATUS_WRITE_INTERVAL_MS) {
          lastStatusWrite = now;
          const elapsed = Math.round((now - startTime) / 1000);
          const statusLine = `running | ${elapsed}s | ${recentLines[recentLines.length - 1] ?? ""}`;
          writeStatusToMemory(callerAgentId, statusLine);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (killed) {
          claudeCodeStream.emitStream({
            agentId: callerAgentId,
            type: "error",
            text: `Timed out after ${Math.round(durationMs / 1000)}s`,
            timestamp: Date.now(),
          });
          writeStatusToMemory(callerAgentId, `timed_out | ${Math.round(durationMs / 1000)}s`);

          log.warn({ durationMs, timeout }, "Claude Code timed out");
          return resolve({
            error: "Claude Code timed out",
            duration_ms: durationMs,
            partial_output: stdout.substring(0, 2000),
          });
        }

        if (code !== 0 && code !== null) {
          claudeCodeStream.emitStream({
            agentId: callerAgentId,
            type: "error",
            text: `Exited with code ${code}: ${stderr.substring(0, 200)}`,
            timestamp: Date.now(),
          });
          writeStatusToMemory(callerAgentId, `error | exit code ${code}`);

          log.warn({ code, stderr: stderr.substring(0, 500) }, "Claude Code error");
          return resolve({
            error: `Process exited with code ${code}`,
            stderr: stderr.substring(0, 2000),
            duration_ms: durationMs,
          });
        }

        const result = parseOutput(stdout, durationMs);

        // Emit completion to dashboard
        claudeCodeStream.emitStream({
          agentId: callerAgentId,
          sessionId: result.session_id as string | undefined,
          type: "complete",
          text: `Done in ${Math.round(durationMs / 1000)}s | $${(result.cost_usd as number)?.toFixed(3) ?? "?"} | ${result.num_turns ?? "?"} turns`,
          timestamp: Date.now(),
        });

        writeStatusToMemory(
          callerAgentId,
          `idle | last session: ${Math.round(durationMs / 1000)}s, $${(result.cost_usd as number)?.toFixed(3) ?? "?"}`,
        );

        log.info(
          { durationMs, costUsd: result.cost_usd, turns: result.num_turns, sessionId: result.session_id },
          "Claude Code completed",
        );

        return resolve(result);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        claudeCodeStream.emitStream({
          agentId: callerAgentId,
          type: "error",
          text: `Spawn error: ${err.message}`,
          timestamp: Date.now(),
        });
        writeStatusToMemory(callerAgentId, `error | ${err.message.substring(0, 80)}`);

        log.warn({ error: err.message }, "Claude Code spawn error");
        return resolve({
          error: err.message,
          duration_ms: durationMs,
        });
      });
    });
  },
});
