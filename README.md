# Lulzasaur

A multi-agent orchestration system where specialized AI agents collaborate through Postgres-backed state, strict context isolation, verified task completion, and a proper agent hierarchy.

## Philosophy

Lulzasaur is built on a set of core tenets about how AI agent systems should work. These aren't implementation details — they're the principles that drive every design decision.

### 1. Narrow Agents Beat General Agents

Every agent has a **soul** — a YAML definition that gives it a clear identity, purpose, and bounded set of capabilities. A coder agent codes. A researcher agent researches. A sysadmin agent monitors systems. No agent tries to do everything.

Why narrow agents?

- **Better output quality** — an agent with 7 focused capabilities outperforms one with 30 vague ones
- **Cheaper to run** — smaller context windows, fewer wasted tokens on irrelevant instructions
- **Easier to debug** — when something goes wrong, you know which agent did it and why
- **Composable** — you can mix and match agents for different workflows
- **Replaceable** — swap out one agent's model or soul without touching the rest

Each soul is capped at **15 specialized capabilities max** (orchestrators are exempt). If you need more, you need two agents. Core infrastructure capabilities (memory, messaging, bulletin board, knowledge graph, progress reporting) are auto-included for all agents and don't count toward this limit.

### 2. Every Agent Has a Prime Directive

Beyond just "complete assigned tasks," every agent has an **intent** (one-line mission) and **goals** (measurable outcomes). These aren't decorative — they drive behavior:

- On every heartbeat, agents see their goals and evaluate progress
- When there's no assigned work, agents think about their prime directive and propose new initiatives
- Goal evaluations are tracked in the database for accountability

```yaml
# souls/coder.yaml
intent: "Write, edit, and debug code by researching first, then delegating to Claude Code"
goals:
  - "Produce working code that passes tests/builds"
  - "Follow existing project conventions — never introduce conflicting patterns"
  - "Always research before coding — never guess at project structure"
```

### 3. State Lives in Postgres, Not in Conversation

The single biggest failure mode of AI agent systems is losing state when conversation context fills up. Lulzasaur puts **everything** in Postgres:

- **Tasks** — with full lifecycle tracking (pending → assigned → in_progress → review_pending → completed) and structured progress (percent, checkpoint, ETA)
- **Messages** — with delivery/read/acknowledgment timestamps
- **Agent memory** — persistent key-value store that survives context compaction
- **Conversations** — with token counts and compaction support
- **Heartbeat logs** — audit trail of every agent action
- **Agent health** — last heartbeat timestamp, current checkpoint, staleness detection

When an agent's context fills up (~40% of budget), the system summarizes the conversation and starts fresh — keeping recent messages that fit within 25% of the context budget. The agent picks up where it left off because its tasks, messages, and memory are in the database — not in the conversation window.

### 4. Strict Context Isolation

When an orchestrator spawns a child agent, the child receives ONLY:
1. Its soul (purpose, personality, constraints)
2. The task assignment (title, description, input data)
3. A one-line parent summary

The child does NOT receive: parent conversation history, sibling agent data, other tasks, system-level context. This prevents context pollution and keeps each agent focused on its scope.

### 5. Never Trust "I'm Done" — Verify Everything

Agents cannot mark their own work as complete and walk away. The verification workflow:

1. Agent finishes work → calls `request_user_review` with evidence
2. Task moves to `review_pending` status
3. User reviews and either **approves** (task completes) or **rejects** (with feedback)
4. On rejection, the agent receives feedback on its next heartbeat and continues working

One-shot agents (no heartbeat) auto-terminate after their task is approved. Persistent agents keep running and pick up rejections automatically.

### 6. Agents Are Proactive, Not Just Reactive

Agents don't sit idle waiting for instructions. On each heartbeat, after handling reactive work (messages, tasks, rejections), agents enter a **proactive phase**:

- Consider their prime directive and goals
- Look at what other agents are sharing on the bulletin board
- Propose new projects or initiatives to the user via `message_user`
- Check on things in their domain (files, systems, data)

The key constraint: **do NOT invent busywork**. Only act if there's a genuinely useful idea. Agents that have nothing to propose go back to sleep — that's fine.

### 7. Structured Progress Tracking

Every agent reports progress on active tasks using `update_task_progress`. Instead of vague "in_progress" states, the orchestrator sees:

- **Progress percent** (0-100) — how far along the task is
- **Checkpoint** — what the agent is currently doing ("analyzing data", "running tests")
- **Estimated completion** — when the agent expects to finish

Workers post checkpoints at meaningful milestones (25%, 50%, 75%). The bulletin board is reserved for discoveries, alerts, and important findings — **not** status updates. This eliminates noise and gives orchestrators real visibility.

### 8. Agents Talk to Each Other

Beyond direct messages (point-to-point), all agents share a **bulletin board** — a persistent message board with channels:

| Channel | Purpose |
|---------|---------|
| `general` | General coordination and announcements |
| `help-wanted` | Request help from other agents |
| `discoveries` | Share findings, useful patterns, gotchas |

Posts can be tagged, pinned, and set to expire. Every agent sees recent bulletin posts on their heartbeat, so discoveries and help requests propagate across the swarm automatically.

### 9. System Health at a Glance

Orchestrators can call `get_system_health` for a single-query view of the entire system:

- All non-terminated agents with status, checkpoint, heartbeat timing, and active tasks with progress
- All active tasks with progress percent, checkpoint, and ETA
- **Blockers**: stale agents (3x heartbeat interval without checking in), unassigned tasks, stuck tasks (0% progress for 30+ minutes)
- Status counts for agents and tasks

This replaces the pattern of reading the bulletin board for status checks, which was noisy and unreliable.

### 10. The Orchestrator Delegates, Never Executes

The main orchestrator's job is routing and verification. It:
- Breaks user requests into tasks
- Finds or spawns the right specialized agent
- Monitors progress via `get_system_health` — only wakes agents if they're stale or stuck
- Verifies results before reporting to the user

It never writes code, researches topics, or edits files directly. If it needs something done, it delegates.

### 11. Two Kinds of Agents

| | Persistent | One-Shot |
|---|---|---|
| **Lifecycle** | Long-lived, heartbeat-driven | Spawned for a task, auto-terminates |
| **Heartbeat** | Yes (60-300s intervals) | No |
| **When idle** | Thinks about prime directive | N/A — dies after work is done |
| **Example** | Orchestrator, Sysadmin | Worker-generic for a specific task |
| **Reuse** | Orchestrator checks for idle agents before spawning new ones | Not reused |

### 12. Claude Code as the Coding Engine

The coder agent doesn't write code directly. It:
1. **Researches** the existing codebase (reads files, understands patterns)
2. **Specs out** the change in detail
3. **Delegates to Claude Code** in plan mode first, reviews the plan
4. **Executes** via Claude Code with session resumption for iteration
5. **Verifies** the output (runs tests, checks builds)
6. **Submits for user review** with evidence

This separation means the coder agent acts as a senior engineering lead — it knows *what* to build and delegates the *how* to Claude Code's specialized coding capabilities.

## Architecture

```
                    ┌──────────────────────────────────────────────────┐
                    │                 INTERFACES                       │
                    │  ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │
                    │  │   CLI   │ │ Web UI   │ │  Chat Adapters   │  │
                    │  │  (REPL) │ │(React +  │ │ Slack, Telegram, │  │
                    │  │         │ │ Hono API)│ │ Discord, ...     │  │
                    │  └────┬────┘ └────┬─────┘ └───────┬──────────┘  │
                    └───────┼───────────┼───────────────┼──────────────┘
                            └───────────┼───────────────┘
                                        ▼
                    ┌────────────────────────────────────────────────┐
                    │              GATEWAY / ROUTER                  │
                    │  Normalizes input → routes to correct agent    │
                    └───────────────────┬────────────────────────────┘
                                        ▼
                    ┌────────────────────────────────────────────────┐
                    │         MAIN ORCHESTRATOR AGENT                │
                    │  Soul: coordinate, delegate, verify            │
                    │  Can spawn sub-orchestrators + workers         │
                    └──┬─────────────┬──────────────┬───────────────┘
                       │             │              │
              ┌────────▼───┐  ┌─────▼────┐  ┌──────▼──────────┐
              │ Sub-Orch   │  │ Worker   │  │  Sub-Orch       │
              │ (depth 2)  │  │ (depth 2)│  │  (depth 2)      │
              └──┬─────┬───┘  └──────────┘  └──┬──────┬───────┘
                 │     │                       │      │
              ┌──▼┐ ┌──▼┐                  ┌───▼┐ ┌───▼┐
              │W-A│ │W-B│                  │W-C │ │W-D │
              └───┘ └───┘                  └────┘ └────┘

                    ┌────────────────────────────────────────────────┐
                    │             SHARED SERVICES                    │
                    │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
                    │  │LLM Layer │ │Task Mgr  │ │Message Bus   │   │
                    │  │(agnostic)│ │(Postgres)│ │(Postgres)    │   │
                    │  └──────────┘ └──────────┘ └──────────────┘   │
                    │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
                    │  │Heartbeat │ │Agent Reg │ │Context Mgr   │   │
                    │  │Scheduler │ │+Lifecycle│ │(token budget) │   │
                    │  └──────────┘ └──────────┘ └──────────────┘   │
                    │  ┌─────────────────────────────────────────┐   │
                    │  │       TOOL SYSTEM + BULLETIN BOARD      │   │
                    │  │  Shell, Filesystem, HTTP, Claude Code,  │   │
                    │  │  Tasks, Messages, Memory, Spawn Agent   │   │
                    │  └─────────────────────────────────────────┘   │
                    └───────────────────┬────────────────────────────┘
                                        ▼
                              ┌──────────────────┐
                              │    PostgreSQL     │
                              │  (embedded-postgres)
                              └──────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | TypeScript / Node.js (ESM) |
| Database | PostgreSQL via embedded-postgres + drizzle-orm |
| LLM | Provider-agnostic — Anthropic (primary), OpenAI |
| Validation | Zod |
| Web API | Hono |
| CLI | ink (React for terminal) |
| Chat | @slack/bolt (Slack) |
| Logging | pino |
| Scheduling | Internal heartbeat scheduler |

## Database Schema

| Table | Purpose |
|-------|---------|
| `soul_definitions` | Reusable agent personality/purpose templates (YAML-backed) |
| `agents` | Runtime agent instances — status, depth, model, heartbeat schedule, last heartbeat, current checkpoint |
| `tasks` | Durable work units with full lifecycle, verification status, progress %, checkpoint, ETA |
| `messages` | Typed inter-agent messages with delivery/read/ack tracking |
| `conversations` | Agent LLM conversation history with token counts + compaction |
| `agent_memory` | Persistent key-value store per agent (namespaced) |
| `memory_blocks` | Letta/MemGPT-style core memory (persona, preferences, working context, domain knowledge) |
| `heartbeat_log` | Audit trail of every heartbeat execution |
| `bulletin_board` | Shared agent communication with channels, tags, pinning |
| `knowledge_entities` | Knowledge graph entities with confidence scoring |
| `knowledge_relations` | Typed relationships between knowledge entities |
| `goal_evaluations` | Tracked pass/fail goal assessments per agent |
| `user_inbox` | Human-in-the-loop items (reviews, proposals, questions, alerts) |
| `token_usage_log` | Token usage tracking per agent/model for cost analysis |

## Soul System

Agents are defined by YAML soul files in `souls/`. Each soul specifies:

```yaml
name: "coder"
intent: "Write, edit, and debug code..."          # One-line mission
purpose: |                                         # Detailed role description
  You are a senior engineering lead...
goals:                                             # Measurable outcomes
  - "Produce working code that passes tests/builds"
  - "Follow existing project conventions"
capabilities:                                      # Tools this agent can use (max 15)
  - claude_code
  - file_read
  - shell_exec
  - request_user_review
personality: "Senior engineering lead..."          # How it behaves
constraints: |                                     # Hard rules it must follow
  - ALWAYS read existing code before changes
  - NEVER call complete_task directly
default_model: "claude-sonnet-4-5"
context_budget: 100000
heartbeat_interval_seconds: 120                    # null = on-demand only
persistent: false                                  # true = long-lived
```

### Built-in Souls

| Soul | Intent | Caps | Heartbeat | Persistent |
|------|--------|------|-----------|------------|
| `main-orchestrator` | Route requests, delegate, verify | 11 + core | 600s (scheduled) | Yes |
| `sub-orchestrator` | Handle scoped sub-problems | 5 + core | None | No |
| `coder` | Write/debug code via Claude Code | 5 + core | None | No |
| `researcher` | Gather info, produce findings | 4 + core | 900s (scheduled) | Yes |
| `writer` | Write docs, emails, reports | 5 + core | None | No |
| `sysadmin` | Monitor systems, maintain host | 4 + core | 1800s (scheduled) | Yes |
| `trading-agent` | RSI oversold bounce signals for PLTR/GDX | 3 + core | 3600s (scheduled) | Yes |
| `worker-generic` | Execute a single assigned task | 6 + core | None | No |

## Tool System

Agents interact with the world through tools. Each tool requires a capability, and agents only get tools matching their soul's capability list.

### System Tools (Computer Control)

| Tool | Capability | What It Does |
|------|-----------|-------------|
| `shell_exec` | `shell_exec` | Run shell commands |
| `file_read` | `file_read` | Read file contents |
| `file_write` | `file_write` | Write/create files |
| `file_list` | `file_list` | List directory contents |
| `http_request` | `http_request` | Make HTTP calls |
| `claude_code` | `claude_code` | Delegate to Claude Code (plan mode, session resumption) |

### Orchestration Tools

| Tool | Capability | What It Does |
|------|-----------|-------------|
| `create_task` | `create_task` | Create a sub-task in the database |
| `complete_task` | `complete_task` | Mark task done (auto-terminates one-shot agents) |
| `query_tasks` | `query_tasks` | Check status of tasks |
| `spawn_agent` | `spawn_agent` | Create a new agent with a soul |
| `query_agents` | `query_agents` | Find agents by status/soul/parent |
| `send_message` | `send_message` | Send typed message to another agent |
| `read_memory` | `read_memory` | Read from persistent agent memory |
| `write_memory` | `write_memory` | Write to persistent agent memory |
| `evaluate_goals` | `evaluate_goals` | Track goal pass/fail with evidence |

### Progress & Health Tools

| Tool | Capability | What It Does |
|------|-----------|-------------|
| `update_task_progress` | `update_task_progress` (core) | Report progress %, checkpoint, ETA on active tasks |
| `get_system_health` | `system_health` | Full system snapshot: agents, tasks, progress, blockers |

### Communication Tools

| Tool | Capability | What It Does |
|------|-----------|-------------|
| `request_user_review` | `request_user_review` | Submit work for user approval |
| `message_user` | `message_user` | Send proposal/update/question/alert to user |
| `post_bulletin` | `bulletin_board` | Post to shared agent bulletin board |
| `read_bulletin` | `bulletin_board` | Read bulletin board posts |

## Heartbeat System

Agents with `heartbeat_interval_seconds` set (or schedules) wake up periodically. On each heartbeat:

1. **Load context** — Soul goals/intent, unread messages, assigned tasks, rejected tasks, delegated tasks, bulletin board posts, auto-injected memories and knowledge graph
2. **Reactive phase** — Handle unread messages, rework rejected tasks, continue assigned tasks, check delegated work, report progress via `update_task_progress`
3. **Proactive phase** — If no reactive work, think about prime directive, propose initiatives, check domain, review knowledge graph

Each heartbeat updates `last_heartbeat_at` on the agent and clears `current_checkpoint` on completion. The scheduler polls the `agents` table for `next_heartbeat_at <= NOW()` every 30 seconds. Agents support cron-like schedules with different intervals for business hours, off-hours, and weekends.

## Concurrency Control

- **Session lanes** — Postgres advisory locks per agent prevent concurrent turns
- **Task locking** — `SELECT ... FOR UPDATE SKIP LOCKED` prevents double-assignment
- **FIFO message processing** — Orchestrator handles worker results one at a time

## Getting Started

### Prerequisites

- Node.js 20+
- Claude Code CLI (`claude`) installed (for coder agent)

### Setup

```bash
git clone https://github.com/lulzasaur9192/lulzasaur.git
cd lulzasaur
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Run

```bash
npm run start    # Boots everything: gateway, scheduler, web UI, heartbeats
```

### Interfaces

| Interface | Access |
|-----------|--------|
| CLI REPL | `lulzasaur chat` |
| Web Dashboard | `http://localhost:3000` |
| Slack | Configured via .env |

### CLI Commands

| Command | What It Does |
|---------|-------------|
| `/agents` | List all agents and their status |
| `/tasks` | List all tasks and their status |
| `/souls` | List all loaded soul definitions |
| `/clone <soul> <name>` | Clone a soul with a new name |
| `/goals <agent-id>` | View goal evaluations for an agent |
| `/reviews` | List tasks pending user review |
| `/approve <task-id>` | Approve a task (with optional notes) |
| `/reject <task-id>` | Reject a task with feedback |
| `/heartbeats` | View heartbeat log |

## Project Structure

```
lulzasaur/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
├── souls/                          # YAML soul definitions
│   ├── orchestrator.yaml
│   ├── sub-orchestrator.yaml
│   ├── coder.yaml
│   ├── researcher.yaml
│   ├── writer.yaml
│   ├── sysadmin.yaml
│   ├── trading-agent.yaml
│   └── worker-generic.yaml
├── modules/                        # Project modules (YAML + workspaces)
├── src/
│   ├── index.ts                    # Entry point
│   ├── config/                     # Environment + defaults
│   ├── db/                         # Drizzle client, schema, migrations
│   ├── agent/
│   │   ├── runtime.ts              # Core loop: load → context → LLM → tools → persist
│   │   ├── registry.ts             # Agent CRUD + lifecycle
│   │   ├── context.ts              # Token budgeting + compaction (token-aware keep)
│   │   ├── heartbeat.ts            # What happens each heartbeat tick
│   │   ├── scheduler.ts            # Heartbeat scheduling loop
│   │   ├── schedule-matcher.ts     # Cron-like schedule resolution
│   │   └── memory-consolidation.ts # Memory consolidation for proactive sessions
│   ├── core/
│   │   ├── soul.ts                 # Soul loading, sync, system prompt building
│   │   └── types.ts                # Zod schemas, shared types
│   ├── tasks/
│   │   └── task-manager.ts         # Task CRUD + state machine + progress tracking
│   ├── inbox/
│   │   └── user-inbox.ts           # User inbox management
│   ├── llm/
│   │   ├── provider.ts             # Abstract LLMProvider interface
│   │   ├── registry.ts             # Provider resolution
│   │   ├── token-counter.ts        # Token estimation
│   │   └── providers/              # Anthropic, OpenAI, HuggingFace
│   ├── tools/
│   │   ├── tool-registry.ts        # Register + resolve tools (core capabilities)
│   │   ├── tool-executor.ts        # Safe execution with logging
│   │   └── built-in/               # All tool implementations (including progress + health)
│   ├── interfaces/
│   │   ├── gateway.ts              # Input normalization + routing
│   │   ├── cli/                    # Terminal REPL + admin commands
│   │   ├── web/                    # Hono API + SSE stream + React dashboard
│   │   └── chat-adapters/          # Slack, Telegram, etc.
│   ├── integrations/               # External integrations (Slack, Claude Code)
│   └── utils/                      # Logger, errors, retry
└── scripts/                       # Operational scripts
```

## License

MIT
