import type { LLMTool } from "../core/types.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  capability: string; // Which capability this tool belongs to
  execute: (agentId: string, input: unknown) => Promise<unknown>;
}

const tools = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function getToolsByCapabilities(capabilities: string[]): ToolDefinition[] {
  return [...tools.values()].filter((t) => capabilities.includes(t.capability));
}

export function toolToLLMFormat(tool: ToolDefinition): LLMTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

export function listTools(): string[] {
  return [...tools.keys()];
}
