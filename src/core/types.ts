import { z } from "zod";

// ── Soul Definition ────────────────────────────────────────────────

const MAX_CAPABILITIES = 10;

const heartbeatScheduleSchema = z.object({
  name: z.string(),
  days: z.array(z.number()).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  timezone: z.string().optional(),
  interval_seconds: z.number(),
});

export const soulSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  intent: z.string().optional(),          // One-liner: what is this agent FOR?
  goals: z.array(z.string()).default([]),  // Specific, measurable goals/KPIs
  capabilities: z.array(z.string()).default([]),
  personality: z.string().optional(),
  constraints: z.string().optional(),
  default_model: z.string().optional(),
  context_budget: z.number().default(150000),
  heartbeat_interval_seconds: z.number().nullable().optional(),
  schedules: z.array(heartbeatScheduleSchema).optional(),
  persistent: z.boolean().default(false), // true = long-lived, false = one-shot (auto-terminate after task)
}).check(
  (ctx) => {
    if (ctx.value.capabilities.length > MAX_CAPABILITIES) {
      ctx.issues.push({
        code: "custom",
        message: `Soul "${ctx.value.name}" has ${ctx.value.capabilities.length} capabilities (max ${MAX_CAPABILITIES}). Narrow agents work better — trim to the essentials.`,
        input: ctx.value,
        path: ["capabilities"],
      });
    }
  },
);

export type SoulDefinition = z.infer<typeof soulSchema>;

// ── Agent Input ────────────────────────────────────────────────────

export interface AgentInput {
  source: "cli" | "web" | "whatsapp" | "telegram" | "discord" | "slack" | "internal";
  text: string;
  senderId?: string;
  senderName?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

// ── Agent Turn Result ──────────────────────────────────────────────

export interface AgentTurnResult {
  agentId: string;
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  durationMs: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// ── LLM Types ──────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | LLMContentBlock[];
}

export interface LLMContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMResponse {
  content: LLMContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: TokenUsage;
  model: string;
}
