import { eq, and } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { agents, conversations, tokenUsageLog } from "../db/schema.js";
import { getProvider } from "../llm/registry.js";
import { estimateMessagesTokens } from "../llm/token-counter.js";
import { buildContext, appendToConversation } from "./context.js";
import { getAgentWithSoul, updateAgentStatus } from "./registry.js";
import { executeToolCall, getToolsForAgent } from "../tools/tool-executor.js";
import { createChildLogger } from "../utils/logger.js";
import { AgentError } from "../utils/errors.js";
import type { AgentTurnResult, ToolCallRecord, LLMContentBlock, LLMMessage } from "../core/types.js";
import type { ConversationMessage, ContentBlock } from "../db/schema.js";

const log = createChildLogger("agent-runtime");

const DEFAULT_MAX_TOOL_ITERATIONS = 30;
const TOOL_RESULT_MAX_CHARS = 4000;

/**
 * Mark the last content block of the last message with cache_control
 * so Anthropic caches the entire stable conversation prefix across
 * tool-loop iterations.
 */
function markPrefixForCaching(messages: LLMMessage[]): void {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return;

  if (typeof lastMsg.content === "string") {
    // Convert to block array so we can attach cache_control
    lastMsg.content = [
      { type: "text", text: lastMsg.content, cache_control: { type: "ephemeral" } },
    ];
  } else if (lastMsg.content.length > 0) {
    lastMsg.content[lastMsg.content.length - 1]!.cache_control = { type: "ephemeral" };
  }
}

function truncateToolResult(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) return content;
  const notice = `\n\n[... truncated — full output was ${content.length} chars]`;
  return content.slice(0, TOOL_RESULT_MAX_CHARS - notice.length) + notice;
}

// Per-million-token pricing (USD) — update when pricing changes
const MODEL_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  "claude-sonnet-4-6":          { input: 3.00, cachedInput: 0.30, output: 15.00 },
  "claude-sonnet-4-5-20250514": { input: 3.00, cachedInput: 0.30, output: 15.00 },
  "claude-haiku-4-5-20251001":  { input: 0.80, cachedInput: 0.08, output: 4.00 },
  // OpenAI models
  "gpt-4o":                                    { input: 2.50, cachedInput: 1.25, output: 10.00 },
  "gpt-4o-mini":                               { input: 0.15, cachedInput: 0.075, output: 0.60 },
  // HuggingFace models — most are free on serverless tier; pro tier pricing shown
  "meta-llama/Llama-3.3-70B-Instruct":        { input: 0.00, cachedInput: 0.00, output: 0.00 },
  "Qwen/Qwen2.5-72B-Instruct":                { input: 0.00, cachedInput: 0.00, output: 0.00 },
  "mistralai/Mistral-Small-24B-Instruct-2501": { input: 0.00, cachedInput: 0.00, output: 0.00 },
  "microsoft/Phi-3-medium-128k-instruct":      { input: 0.00, cachedInput: 0.00, output: 0.00 },
};

function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-6"]!;
  const nonCachedInput = inputTokens - cacheCreationTokens - cacheReadTokens;
  return (
    (nonCachedInput / 1_000_000) * pricing.input +
    (cacheCreationTokens / 1_000_000) * pricing.input * 1.25 +
    (cacheReadTokens / 1_000_000) * pricing.cachedInput +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Run a single agent turn: build context → LLM call → tool loop → persist.
 * This is THE core loop of the entire system.
 */
export async function runAgentTurn(
  agentId: string,
  userMessage?: string,
): Promise<AgentTurnResult> {
  const startTime = Date.now();
  const toolCalls: ToolCallRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;

  // Load agent + soul
  const data = await getAgentWithSoul(agentId);
  if (!data || !data.soul) {
    throw new AgentError(`Agent ${agentId} not found or missing soul`, agentId);
  }
  const { agent, soul } = data;

  // Mark active
  await updateAgentStatus(agentId, "active");

  try {
    // Append user message to conversation if provided
    if (userMessage) {
      await appendToConversation(agentId, {
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      });
    }

    // Build context (may trigger compaction)
    const context = await buildContext(
      agentId,
      {
        name: soul.name,
        purpose: soul.purpose,
        intent: soul.intent,
        goals: soul.goals as string[],
        personality: soul.personality,
        constraints: soul.constraints,
        capabilities: soul.capabilities as string[],
      },
      agent.contextBudget ?? 150000,
    );

    // Get available tools for this agent
    const tools = getToolsForAgent(soul.capabilities as string[]);

    // Get LLM provider
    const provider = getProvider(agent.provider ?? "anthropic");
    const model = agent.model ?? "claude-sonnet-4-6";

    // ── Tool loop ──
    const maxIterations = agent.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    let currentMessages = [...context.messages];
    markPrefixForCaching(currentMessages);
    let iteration = 0;
    let finalResponse = "";

    while (iteration < maxIterations) {
      iteration++;

      const response = await provider.chat(currentMessages, {
        model,
        maxTokens: 4096,
        systemPrompt: context.systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      totalCacheCreationTokens += response.usage.cacheCreationInputTokens ?? 0;
      totalCacheReadTokens += response.usage.cacheReadInputTokens ?? 0;

      // Process response content blocks
      const textBlocks: string[] = [];
      const toolUseBlocks: LLMContentBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text" && block.text) {
          textBlocks.push(block.text);
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }

      // Save assistant message to conversation (preserve structured blocks for tool_use)
      const assistantContent: string | ContentBlock[] =
        toolUseBlocks.length === 0
          ? textBlocks.join("\n")
          : response.content.map((b): ContentBlock => ({
              type: b.type,
              text: b.text,
              id: b.id,
              name: b.name,
              input: b.input,
              toolUseId: b.tool_use_id,
              content: b.content,
            }));

      await appendToConversation(agentId, {
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
      });

      // Add assistant response to current messages for next iteration
      currentMessages.push({
        role: "assistant",
        content: response.content,
      });

      // If no tool calls, we're done
      if (response.stopReason !== "tool_use" || toolUseBlocks.length === 0) {
        finalResponse = textBlocks.join("\n");
        break;
      }

      // Execute tool calls and collect results.
      // CRITICAL: Tool results MUST be saved to the conversation even if something fails,
      // otherwise we get orphaned tool_use blocks that cause Anthropic 400 errors.
      const toolResultBlocks: LLMContentBlock[] = [];

      try {
        for (const toolBlock of toolUseBlocks) {
          const toolStart = Date.now();
          let output: unknown;
          let error: string | undefined;

          try {
            output = await executeToolCall(agentId, toolBlock.name!, toolBlock.input);
            log.debug({ agentId, tool: toolBlock.name, durationMs: Date.now() - toolStart }, "Tool executed");
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            output = { error };
            log.warn({ agentId, agentName: agent.name, tool: toolBlock.name, error }, "Tool execution failed");
          }

          toolCalls.push({
            id: toolBlock.id!,
            name: toolBlock.name!,
            input: toolBlock.input,
            output,
            durationMs: Date.now() - toolStart,
            error,
          });

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolBlock.id!,
            content: typeof output === "string" ? output : JSON.stringify(output),
            is_error: !!error,
          });
        }
      } catch (unexpectedError) {
        // If the tool loop itself throws unexpectedly, fill in error results for any missing tools
        log.error({ agentId, agentName: agent.name, error: String(unexpectedError) }, "Unexpected error in tool execution loop");
        for (const toolBlock of toolUseBlocks) {
          if (!toolResultBlocks.some((r) => r.tool_use_id === toolBlock.id)) {
            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: toolBlock.id!,
              content: JSON.stringify({ error: `Tool execution aborted: ${String(unexpectedError)}` }),
              is_error: true,
            });
          }
        }
      }

      // Save tool results to conversation — this MUST succeed to avoid orphaned tool_use blocks
      await appendToConversation(agentId, {
        role: "user",
        content: toolResultBlocks.map((b): ContentBlock => ({
          type: "tool_result",
          toolUseId: b.tool_use_id,
          content: b.content,
          isError: b.is_error,
        })),
        timestamp: new Date().toISOString(),
      });

      // Add tool results to messages for next LLM call (truncated to save tokens)
      currentMessages.push({
        role: "user",
        content: toolResultBlocks.map((b) => ({
          ...b,
          content: b.content ? truncateToolResult(b.content) : b.content,
        })),
      });

      // Mid-turn context budget check — stop if context is growing too large
      const budget = agent.contextBudget ?? 150000;
      const midTurnEstimate = estimateMessagesTokens(currentMessages);
      if (midTurnEstimate > budget * 0.7) {
        log.warn({ agentId, agentName: agent.name, midTurnEstimate, budget, iteration }, "Mid-turn context near budget, stopping tool loop");
        finalResponse = textBlocks.join("\n");
        break;
      }

      finalResponse = textBlocks.join("\n");
    }

    if (iteration >= maxIterations) {
      log.warn({ agentId, agentName: agent.name, iterations: iteration }, "Agent hit max tool iterations");
      finalResponse += "\n[Reached maximum tool call iterations]";
    }

    // Mark idle
    await updateAgentStatus(agentId, "idle");

    const result: AgentTurnResult = {
      agentId,
      response: finalResponse,
      toolCalls,
      tokenUsage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        cacheCreationInputTokens: totalCacheCreationTokens,
        cacheReadInputTokens: totalCacheReadTokens,
      },
      durationMs: Date.now() - startTime,
    };

    log.debug(
      {
        agentId,
        toolCalls: toolCalls.length,
        tokens: result.tokenUsage.totalTokens,
        durationMs: result.durationMs,
      },
      "Agent turn completed",
    );

    // Log token usage to DB for cost analysis
    try {
      const db = getDb();
      await db.insert(tokenUsageLog).values({
        agentId,
        agentName: agent.name,
        model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        cacheCreationInputTokens: totalCacheCreationTokens,
        cacheReadInputTokens: totalCacheReadTokens,
        toolCalls: toolCalls.length,
        iterations: iteration,
        trigger: userMessage?.startsWith("[HEARTBEAT]") ? "heartbeat" : "chat",
        contextTokensAtStart: context.tokenEstimate,
        estimatedCostUsd: estimateCostUsd(model, totalInputTokens, totalOutputTokens, totalCacheCreationTokens, totalCacheReadTokens),
        durationMs: result.durationMs,
      });
    } catch (e) {
      log.warn({ error: String(e) }, "Failed to log token usage");
    }

    return result;
  } catch (error) {
    await updateAgentStatus(agentId, "idle");
    log.error({ agentId, agentName: agent.name, error: String(error) }, "Agent turn failed");
    throw error;
  }
}
