import { EventEmitter } from "node:events";

/**
 * Lightweight event bus for streaming Claude Code output to the dashboard.
 * This is a SIDE-CHANNEL — output goes directly to SSE listeners,
 * never through the agent's context (zero extra token cost).
 */

export interface ClaudeCodeStreamEvent {
  agentId: string;
  sessionId?: string;
  type: "start" | "output" | "status" | "complete" | "error";
  /** The raw output line (for type=output) or summary text */
  text: string;
  timestamp: number;
}

class ClaudeCodeStreamBus extends EventEmitter {
  /** Emit a stream event to all SSE listeners */
  emitStream(event: ClaudeCodeStreamEvent): void {
    this.emit("claude_code_output", event);
  }

  /** Subscribe to stream events */
  onStream(listener: (event: ClaudeCodeStreamEvent) => void): void {
    this.on("claude_code_output", listener);
  }

  /** Unsubscribe */
  offStream(listener: (event: ClaudeCodeStreamEvent) => void): void {
    this.off("claude_code_output", listener);
  }
}

// Singleton — shared between claude-code tool and SSE endpoint
export const claudeCodeStream = new ClaudeCodeStreamBus();
