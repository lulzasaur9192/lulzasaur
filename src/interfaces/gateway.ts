import { runAgentTurn } from "../agent/runtime.js";
import { createChildLogger } from "../utils/logger.js";
import type { AgentInput, AgentTurnResult } from "../core/types.js";

const log = createChildLogger("gateway");

/**
 * Gateway normalizes all inputs and routes them to the correct agent.
 * For now, routes everything to the main orchestrator.
 */
export async function handleInput(
  agentId: string,
  input: AgentInput,
): Promise<AgentTurnResult> {
  log.debug(
    { source: input.source, agentId, textLength: input.text.length },
    "Gateway received input",
  );

  const result = await runAgentTurn(agentId, input.text);

  log.debug(
    {
      agentId,
      responseLength: result.response.length,
      toolCalls: result.toolCalls.length,
      tokens: result.tokenUsage.totalTokens,
    },
    "Gateway processed input",
  );

  return result;
}
