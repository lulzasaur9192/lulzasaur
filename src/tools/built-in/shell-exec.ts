import { exec } from "node:child_process";
import { registerTool } from "../tool-registry.js";
import { getConfig } from "../../config/index.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-shell");

interface ShellExecInput {
  command: string;
  cwd?: string;
  timeout_ms?: number;
}

registerTool({
  name: "shell_exec",
  description: "Execute a shell command and return stdout/stderr. Use for running scripts, builds, git commands, etc.",
  capability: "shell_exec",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      cwd: { type: "string", description: "Working directory (optional)" },
      timeout_ms: { type: "number", description: "Timeout in milliseconds (optional)" },
    },
    required: ["command"],
  },
  execute: async (_agentId: string, input: unknown) => {
    const config = getConfig();
    const { command, cwd, timeout_ms } = input as ShellExecInput;

    log.info({ command, cwd }, "Executing shell command");

    return new Promise((resolve) => {
      const proc = exec(command, {
        cwd: cwd ?? process.cwd(),
        timeout: timeout_ms ?? config.SHELL_TIMEOUT_MS,
        maxBuffer: config.SHELL_MAX_OUTPUT_BYTES,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => { stdout += data; });
      proc.stderr?.on("data", (data) => { stderr += data; });

      proc.on("close", (code) => {
        const result = {
          exit_code: code,
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 10000),
        };
        log.debug({ command, exitCode: code }, "Shell command completed");
        resolve(result);
      });

      proc.on("error", (err) => {
        resolve({
          exit_code: -1,
          stdout: "",
          stderr: err.message,
        });
      });
    });
  },
});
