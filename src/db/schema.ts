import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────

export const agentStatusEnum = pgEnum("agent_status", [
  "idle",
  "active",
  "sleeping",
  "terminated",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "assigned",
  "in_progress",
  "review_pending",
  "completed",
  "failed",
  "cancelled",
]);

export const taskTypeEnum = pgEnum("task_type", [
  "task",
  "epic",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified",
  "verified",
  "rejected",
]);

export const messageTypeEnum = pgEnum("message_type", [
  "task_assignment",
  "task_result",
  "task_verification",
  "chat",
  "system",
  "heartbeat_trigger",
]);

// ── Projects ──────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  path: text("path").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Soul Definitions ───────────────────────────────────────────────

export const soulDefinitions = pgTable("soul_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  purpose: text("purpose").notNull(),
  intent: text("intent"),
  goals: jsonb("goals").$type<string[]>().notNull().default([]),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  personality: text("personality"),
  constraints: text("constraints"),
  defaultModel: text("default_model"),
  defaultProvider: text("default_provider"),
  maxToolIterations: integer("max_tool_iterations"),
  contextBudget: integer("context_budget").default(150000),
  heartbeatIntervalSeconds: integer("heartbeat_interval_seconds"),
  schedules: jsonb("schedules").$type<HeartbeatSchedule[]>(),
  persistent: boolean("persistent").notNull().default(false),
  rawYaml: text("raw_yaml"),
  projectId: uuid("project_id").references(() => projects.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Agents ─────────────────────────────────────────────────────────

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    soulId: uuid("soul_id").references(() => soulDefinitions.id),
    status: agentStatusEnum("status").notNull().default("idle"),
    depth: integer("depth").notNull().default(1),
    parentId: uuid("parent_id").references((): any => agents.id),
    model: text("model"),
    provider: text("provider"),
    maxToolIterations: integer("max_tool_iterations"),
    contextBudget: integer("context_budget").default(150000),
    heartbeatIntervalSeconds: integer("heartbeat_interval_seconds"),
    schedules: jsonb("schedules").$type<HeartbeatSchedule[]>(),
    nextHeartbeatAt: timestamp("next_heartbeat_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    currentCheckpoint: text("current_checkpoint"),
    projectId: uuid("project_id").references(() => projects.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_agents_status").on(table.status),
    index("idx_agents_parent").on(table.parentId),
    index("idx_agents_heartbeat").on(table.nextHeartbeatAt),
    index("idx_agents_project").on(table.projectId),
  ],
);

// ── Tasks ──────────────────────────────────────────────────────────

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    verificationStatus: verificationStatusEnum("verification_status")
      .notNull()
      .default("unverified"),
    createdBy: uuid("created_by").references(() => agents.id),
    assignedTo: uuid("assigned_to").references(() => agents.id),
    parentTaskId: uuid("parent_task_id").references((): any => tasks.id),
    type: taskTypeEnum("type").notNull().default("task"),
    projectId: uuid("project_id").references(() => projects.id),
    input: jsonb("input").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    verificationNotes: text("verification_notes"),
    priority: integer("priority").default(0),
    progressPercent: integer("progress_percent").notNull().default(0),
    checkpoint: text("checkpoint"),
    estimatedCompletionAt: timestamp("estimated_completion_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_assigned").on(table.assignedTo),
    index("idx_tasks_created_by").on(table.createdBy),
    index("idx_tasks_project").on(table.projectId),
    index("idx_tasks_parent").on(table.parentTaskId),
  ],
);

// ── Messages ───────────────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: messageTypeEnum("type").notNull(),
    fromAgentId: uuid("from_agent_id").references(() => agents.id),
    toAgentId: uuid("to_agent_id").references(() => agents.id).notNull(),
    taskId: uuid("task_id").references(() => tasks.id),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_messages_to_agent").on(table.toAgentId),
    index("idx_messages_unread").on(table.toAgentId, table.readAt),
  ],
);

// ── Conversations ──────────────────────────────────────────────────

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    isActive: boolean("is_active").notNull().default(true),
    messages: jsonb("messages").$type<ConversationMessage[]>().notNull().default([]),
    tokenCount: integer("token_count").notNull().default(0),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_conversations_agent_active").on(table.agentId, table.isActive),
  ],
);

// ── Memory Blocks (Letta/MemGPT-style core memory) ────────────────

export const memoryBlocks = pgTable(
  "memory_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    value: text("value").notNull().default(""),
    charLimit: integer("char_limit").notNull().default(2000),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_memory_blocks_agent").on(table.agentId),
    index("idx_memory_blocks_agent_label").on(table.agentId, table.label),
  ],
);

// ── Agent Memory ───────────────────────────────────────────────────

export const agentMemory = pgTable(
  "agent_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    namespace: text("namespace").notNull().default("default"),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_memory_agent_ns_key").on(table.agentId, table.namespace, table.key),
  ],
);

// ── Heartbeat Log ──────────────────────────────────────────────────

export const heartbeatLog = pgTable(
  "heartbeat_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
  },
  (table) => [
    index("idx_heartbeat_agent").on(table.agentId),
  ],
);

// ── Bulletin Board (shared agent communication) ───────────────────

export const bulletinBoard = pgTable(
  "bulletin_board",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorAgentId: uuid("author_agent_id")
      .references(() => agents.id)
      .notNull(),
    channel: text("channel").notNull().default("general"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    pinned: boolean("pinned").notNull().default(false),
    projectId: uuid("project_id").references(() => projects.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_bulletin_channel").on(table.channel),
    index("idx_bulletin_created").on(table.createdAt),
    index("idx_bulletin_project").on(table.projectId),
  ],
);

// ── Inbox ─────────────────────────────────────────────────────────

export const inboxItemTypeEnum = pgEnum("inbox_item_type", [
  "review",
  "proposal",
  "question",
  "alert",
  "update",
]);

export const inboxItemStatusEnum = pgEnum("inbox_item_status", [
  "pending",
  "approved",
  "rejected",
  "dismissed",
  "replied",
]);

export const userInbox = pgTable(
  "user_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: inboxItemTypeEnum("type").notNull(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    agentName: text("agent_name").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    taskId: uuid("task_id").references(() => tasks.id),
    status: inboxItemStatusEnum("status").notNull().default("pending"),
    userResponse: text("user_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_user_inbox_status").on(table.status),
    index("idx_user_inbox_task").on(table.taskId),
  ],
);

// ── Token Usage Log ──────────────────────────────────────────────

export const tokenUsageLog = pgTable(
  "token_usage_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "set null" }),
    agentName: text("agent_name").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    iterations: integer("iterations").notNull().default(0),
    trigger: text("trigger").notNull().default("heartbeat"), // "heartbeat" | "chat" | "api"
    contextTokensAtStart: integer("context_tokens_at_start"),
    estimatedCostUsd: real("estimated_cost_usd"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_token_usage_agent").on(table.agentId),
    index("idx_token_usage_created").on(table.createdAt),
    index("idx_token_usage_model").on(table.model),
  ],
);

// ── Knowledge Graph ──────────────────────────────────────────────

export const entityTypeEnum = pgEnum("entity_type", [
  "project",
  "decision",
  "research",
  "lesson",
  "preference",
  "person",
  "system",
  "concept",
]);

export const knowledgeEntities = pgTable(
  "knowledge_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    entityType: entityTypeEnum("entity_type").notNull(),
    content: text("content").notNull(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    confidence: integer("confidence").notNull().default(80),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_kg_entities_agent").on(table.agentId),
    index("idx_kg_entities_project").on(table.projectId),
    index("idx_kg_entities_type").on(table.entityType),
    index("idx_kg_entities_name").on(table.name),
  ],
);

export const knowledgeRelations = pgTable(
  "knowledge_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceEntityId: uuid("source_entity_id")
      .references(() => knowledgeEntities.id, { onDelete: "cascade" })
      .notNull(),
    targetEntityId: uuid("target_entity_id")
      .references(() => knowledgeEntities.id, { onDelete: "cascade" })
      .notNull(),
    relationType: text("relation_type").notNull(),
    strength: integer("strength").notNull().default(50),
    context: text("context"),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_kg_relations_source").on(table.sourceEntityId),
    index("idx_kg_relations_target").on(table.targetEntityId),
    index("idx_kg_relations_type").on(table.relationType),
    index("idx_kg_relations_agent").on(table.agentId),
  ],
);

// ── Goal Evaluations ──────────────────────────────────────────────

export const goalEvaluations = pgTable(
  "goal_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    goal: text("goal").notNull(),
    passed: boolean("passed").notNull(),
    evidence: text("evidence"),
    taskId: uuid("task_id").references(() => tasks.id),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_goal_evals_agent").on(table.agentId),
  ],
);

// ── Types ──────────────────────────────────────────────────────────

export interface HeartbeatSchedule {
  name: string;
  days?: number[];     // 0=Sun, 1=Mon, ... 6=Sat
  start_time?: string; // "HH:mm"
  end_time?: string;   // "HH:mm"
  timezone?: string;   // IANA timezone (e.g. "America/New_York")
  interval_seconds: number;
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
  timestamp: string;
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}
