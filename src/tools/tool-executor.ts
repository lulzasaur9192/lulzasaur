import { getTool, getToolsByCapabilities, toolToLLMFormat } from "./tool-registry.js";
import { ToolError } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";
import type { LLMTool } from "../core/types.js";

const log = createChildLogger("tool-executor");

export async function executeToolCall(
  agentId: string,
  toolName: string,
  input: unknown,
): Promise<unknown> {
  const tool = getTool(toolName);
  if (!tool) {
    throw new ToolError(`Unknown tool: ${toolName}`, toolName);
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
  const tools = getToolsByCapabilities(capabilities);
  return tools.map(toolToLLMFormat);
}
