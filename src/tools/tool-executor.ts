import { getTool, getToolsByCapabilities, toolToLLMFormat, listTools, CORE_CAPABILITIES } from "./tool-registry.js";
import { ToolError } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";
import type { LLMTool } from "../core/types.js";

const log = createChildLogger("tool-executor");

// Common aliases that open-source models hallucinate instead of real tool names.
// Maps hallucinated name → actual registered tool name.
const TOOL_ALIASES: Record<string, string> = {
  bash_exec: "shell_exec",
  bash: "shell_exec",
  run_bash: "shell_exec",
  run_command: "shell_exec",
  execute_command: "shell_exec",
  exec: "shell_exec",
  run_shell: "shell_exec",
  terminal: "shell_exec",
  read_file: "file_read",
  write_file: "file_write",
  list_files: "file_list",
  ls: "file_list",
  search: "kg_search",
  web_request: "http_request",
  fetch: "http_request",
  curl: "http_request",
  post_message: "send_message",
  create_agent: "spawn_agent",
};

export async function executeToolCall(
  agentId: string,
  toolName: string,
  input: unknown,
): Promise<unknown> {
  let tool = getTool(toolName);

  // If exact match fails, try alias mapping
  if (!tool) {
    const aliased = TOOL_ALIASES[toolName];
    if (aliased) {
      tool = getTool(aliased);
      if (tool) {
        log.warn({ agentId, requested: toolName, resolved: aliased }, "Resolved hallucinated tool name via alias");
      }
    }
  }

  if (!tool) {
    const available = listTools().join(", ");
    throw new ToolError(`Unknown tool: ${toolName}. Available tools: ${available}`, toolName);
  }

  log.debug({ agentId, tool: toolName }, "Executing tool");

  try {
    const result = await tool.execute(agentId, input);
    return result;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      `Tool ${toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
      toolName,
      { agentId, input },
    );
  }
}

export function getToolsForAgent(capabilities: string[]): LLMTool[] {
  // Merge soul capabilities with core capabilities (plumbing every agent gets)
  const allCaps = [...new Set([...capabilities, ...CORE_CAPABILITIES])];
  const tools = getToolsByCapabilities(allCaps);
  return tools.map(toolToLLMFormat);
}
