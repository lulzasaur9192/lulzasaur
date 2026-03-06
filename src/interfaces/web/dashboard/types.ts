// ── Agent ──
export interface Agent {
  id: string;
  name: string;
  status: "idle" | "active" | "sleeping" | "terminated";
  model: string | null;
  depth: number;
  projectId: string | null;
  createdAt: string;
  heartbeatIntervalSeconds: number | null;
}

export interface AgentDetail extends Agent {
  soulId: string;
}

// ── Project ──
export interface Project {
  id: string;
  displayName: string;
  active: boolean;
}

// ── Task ──
export type TaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "review_pending"
  | "completed"
  | "failed"
  | "cancelled";
export type TaskType = "epic" | "task";
export type VerificationStatus = "unverified" | "verified" | "rejected";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  type: TaskType;
  priority: number;
  assignedTo: string | null;
  projectId: string | null;
  parentId: string | null;
  verificationStatus: VerificationStatus;
  verificationNotes: string | null;
  result: unknown;
  createdAt: string;
}

// ── Bulletin ──
export interface BulletinPost {
  id: string;
  title: string;
  body: string;
  channel: string;
  author: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  replies?: BulletinReply[];
}

export interface BulletinReply {
  author: string;
  body: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  isActive: boolean;
  messages: ConversationMessage[];
  tokenCount: number;
}

export interface ConversationMessage {
  role: string;
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: string;
  text?: string;
}

// ── Activity ──
export interface Heartbeat {
  id: string;
  agentId: string;
  agentName: string;
  triggeredAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  result: { response?: string; toolCalls?: number; skipped?: boolean; reason?: string } | null;
}

export interface ScheduleData {
  agents: ScheduleAgent[];
  dayHeaders: DayHeader[];
}

export interface ScheduleAgent {
  agentName: string;
  projectId: string | null;
  status: string;
  defaultInterval: number | null;
  nextHeartbeatAt: string | null;
  hourly: HourlySlot[];
}

export interface HourlySlot {
  day: number;
  hour: number;
  intervalSeconds: number;
  wakeupsPerHour: number;
  scheduleName?: string;
}

export interface DayHeader {
  dayLabel: string;
  date: string;
  isToday: boolean;
}

// ── Tokens ──
export interface TokenSummary {
  totals: {
    calls: number;
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    estimatedCostUSD: number;
  };
  byAgent: TokenAgentRow[];
}

export interface TokenAgentRow {
  agentName: string;
  model: string;
  trigger: string;
  calls: number;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  avgDurationMs: number | null;
}

export interface TokenHourly {
  hour: string;
  totalTokens: number;
  calls: number;
}

export interface TokenEntry {
  createdAt: string;
  agentName: string;
  model: string;
  trigger: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  durationMs: number | null;
}

// ── Epic (project view) ──
export interface Epic {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  progress: number;
  children: Task[];
}

// ── SSE Events ──
export interface SSEClaudeCodeEvent {
  agentId: string;
  type: "start" | "status" | "complete" | "error";
  text: string;
  timestamp: string;
}

// ── Trash ──
export type TrashItemType = "message" | "bulletin_post" | "task";

export interface TrashItem {
  id: string;
  itemType: TrashItemType;
  itemId: string;
  preview: string;
  reason: string | null;
  trashedByName: string | null;
  trashedAt: string;
}

// ── Pages ──
export type Page =
  | "agents"
  | "tasks"
  | "bulletin"
  | "activity"
  | "tokens"
  | "trash"
  | "agent-detail"
  | "project-agents"
  | "project-epics"
  | "project-bulletin";
