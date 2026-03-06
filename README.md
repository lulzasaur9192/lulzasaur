# Lulzasaur

A multi-agent orchestration system where specialized AI agents collaborate through Postgres-backed state, strict context isolation, verified task completion, and a proper agent hierarchy.

## Table of Contents

- [Philosophy](#philosophy)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [Soul System](#soul-system)
- [Tool System](#tool-system)
- [Heartbeat System](#heartbeat-system)
- [Concurrency Control](#concurrency-control)
- [Planner Agent + Task Dispatcher](#planner-agent--task-dispatcher)
- [Web Dashboard](#web-dashboard)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)

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

- **Tasks** — with full lifecycle tracking (planned → pending → assigned → in_progress → review_pending → completed) and structured progress (percent, checkpoint, ETA), dependency tracking, and suggested soul assignment
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
- Propose new projects or initiatives to the user via `request_user_review`
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
- For simple tasks: finds or spawns the right specialized agent directly
- For complex multi-step projects (3+ steps): spawns a **planner agent** to create a structured task breakdown with dependencies
- Monitors progress via `get_system_health` — only wakes agents if they're stale or stuck
- Verifies results before reporting to the user
- Handles coding tasks directly via Claude Code for efficiency

It never writes code, researches topics, or edits files directly (except via Claude Code). If it needs something done, it delegates.

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
| LLM | Provider-agnostic — Anthropic, OpenAI, HuggingFace Inference API |
| Validation | Zod |
| Web API | Hono + SSE (Server-Sent Events) |
| Dashboard | React SPA (bundled with esbuild) |
| CLI | ink (React for terminal) |
| Chat | @slack/bolt (Slack, Socket Mode) |
| Logging | pino |
| Scheduling | Internal heartbeat scheduler with cron-like schedules |

## Database Schema

| Table | Purpose |
|-------|---------|
| `soul_definitions` | Reusable agent personality/purpose templates (YAML-backed) |
| `agents` | Runtime agent instances — status, depth, model, heartbeat schedule, last heartbeat, current checkpoint |
| `tasks` | Durable work units with full lifecycle, verification status, progress %, checkpoint, ETA, dependency tracking (`depends_on`), and soul recommendation (`suggested_soul`) |
| `messages` | Typed inter-agent messages with delivery/read/ack tracking |
| `conversations` | Agent LLM conversation history with token counts + compaction |
| `agent_memory` | Persistent key-value store per agent (namespaced) |
| `memory_blocks` | Letta/MemGPT-style core memory (persona, preferences, working context, domain knowledge) |
| `heartbeat_log` | Audit trail of every heartbeat execution |
| `bulletin_board` | Shared agent communication with channels, tags, pinning |
| `knowledge_entities` | Knowledge graph entities with confidence scoring |
| `knowledge_relations` | Typed relationships between knowledge entities |
| `goal_evaluations` | Tracked pass/fail goal assessments per agent |
| `system_trash` | Soft-deleted items (messages, tasks, bulletin posts) with restore support |
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
| `main-orchestrator` | Route requests, delegate, verify | 12 + core | 600s (scheduled) | Yes |
| `planner` | Decompose complex requirements into dependency-aware task plans | 9 | None | No |
| `sub-orchestrator` | Handle scoped sub-problems | 5 + core | None | No |
| `coder` | Write/debug code via Claude Code | 5 + core | None | No |
| `researcher` | Gather info, produce findings | 4 + core | 900s (scheduled) | Yes |
| `writer` | Write docs, emails, reports | 5 + core | None | No |
| `sysadmin` | Monitor systems, maintain host | 4 + core | 1800s (scheduled) | Yes |
| `worker-generic` | Execute a single assigned task | 6 + core | None | No |

### Example Project: Prop Shop

The `trading-agent` soul ships as an example of a domain-specific agent built on top of the core system. It's part of the **prop-shop** project — an automated paper trading system that demonstrates how to build projects with their own agents, tasks, and workflows.

| Soul | Intent | Caps | Heartbeat | Persistent |
|------|--------|------|-----------|------------|
| `trading-agent` | RSI oversold bounce signals for PLTR/GDX | 3 + core | 3600s (scheduled) | Yes |

The prop-shop project lives in `projects/prop-shop/` and includes its own soul definitions, data pipeline scripts, risk management rules, and backtesting engine. See [docs/PROP_SHOP.md](docs/PROP_SHOP.md) for details and [docs/PROJECTS.md](docs/PROJECTS.md) for how to create your own projects.

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
| `approve_plan` | `approve_plan` | Approve a plan epic, activating its planned child tasks |
| `read_memory` | `read_memory` | Read from persistent agent memory |
| `write_memory` | `write_memory` | Write to persistent agent memory |
| `evaluate_goals` | `evaluate_goals` | Track goal pass/fail with evidence |

### Progress & Health Tools

| Tool | Capability | What It Does |
|------|-----------|-------------|
| `update_task_progress` | `update_task_progress` (core) | Report progress %, checkpoint, ETA on active tasks |
| `get_system_health` | `system_health` | Full system snapshot: agents, tasks, progress, blockers |

### Web Tools

| Tool | Capability | What It Does |
|------|-----------|-------------|
| `web_search` | `web_search` | Search the web via Tavily (general, news, finance topics) |
| `web_fetch` | `web_search` | Extract clean content from URLs (strips ads/boilerplate) |

### Communication Tools

| Tool | Capability | What It Does |
|------|-----------|-------------|
| `request_user_review` | `request_user_review` | Submit work for user approval |
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

## Planner Agent + Task Dispatcher

For complex multi-step projects, Lulzasaur uses a dedicated planning phase and automated task dispatching instead of ad-hoc task decomposition.

### The Problem

Without structured planning, long-lived multi-step tasks get stuck because:
1. Task decomposition is ad-hoc — the LLM decides on the fly during a heartbeat
2. There's no dependency ordering between tasks
3. Task completion doesn't trigger anything — the orchestrator only notices on its next heartbeat (up to 10-30 min)

### How It Works

```
User Request → Orchestrator → Planner Agent → Epic + Tasks (planned)
                                                    ↓
                                            User Approves Plan
                                                    ↓
                                        Tasks move to "pending"
                                                    ↓
                                    Task Dispatcher assigns agents
                                                    ↓
                              Agents work (respecting dependency order)
                                                    ↓
                                    Epic auto-completes when done
```

### Task Lifecycle with Planning

Tasks now support a `planned` status that sits before `pending`:

```
planned → pending → assigned → in_progress → review_pending → completed
                                                              → failed
                                                              → cancelled
```

- **planned**: Created by planner, awaiting user approval. Not visible to the dispatcher.
- **pending**: Approved and ready. The dispatcher picks these up automatically.

### Planner Agent

The planner (`souls/planner.yaml`) is a non-persistent agent spawned by the orchestrator for complex requests. It:

1. Analyzes the requirement
2. Creates an **epic** (parent task container) via `create_task`
3. Creates child tasks under the epic with:
   - `status: "planned"` — awaiting approval
   - `suggested_soul` — which specialist should handle it (`coder`, `researcher`, `writer`, `worker-generic`)
   - `depends_on` — task IDs that must complete first (enables dependency ordering)
   - Detailed descriptions with acceptance criteria
4. Submits for user review via `request_user_review`

### Task Dispatcher

The dispatcher (`src/tasks/task-dispatcher.ts`) runs automatically at the end of every heartbeat poll cycle. It:

1. **Finds ready tasks**: Queries all `pending` tasks, checks their `depends_on` arrays, and filters to tasks whose dependencies are all resolved (completed, failed, cancelled, or deleted)
2. **Dispatches tasks**: For each ready task:
   - Reads `suggested_soul` (fallback: `worker-generic`)
   - For persistent souls (researcher, sysadmin): finds an existing idle agent and wakes it
   - For one-shot souls: spawns a new child agent
   - Uses optimistic locking (`WHERE status = 'pending'`) to prevent double-dispatch
3. **Handles failures**: On spawn failure, logs the error, notifies the orchestrator, and leaves the task pending for retry on the next cycle

The dispatcher also runs when:
- A plan is approved (tasks transition from `planned` → `pending`)
- A task completes (may unblock dependent tasks)

### Plan Approval

Plans can be approved three ways:

| Method | How |
|--------|-----|
| **Web dashboard** | `POST /api/tasks/:id/approve` on the epic |
| **CLI** | `/approve <epic-id>` |
| **Orchestrator** | `approve_plan` tool (for straightforward plans) |

Approval transitions all `planned` children to `pending` and sets the epic to `in_progress`. The dispatcher immediately picks up newly pending tasks.

### Epic Completion Rollup

When all child tasks under an epic reach a terminal state (completed, failed, cancelled), the epic auto-completes:
- Sets progress to 100%
- Records how many tasks succeeded vs failed
- Sends an `epic_completed` message to the orchestrator

### New Schema Fields

| Column | Type | Description |
|--------|------|-------------|
| `tasks.depends_on` | `jsonb (string[])` | Task IDs this task depends on |
| `tasks.suggested_soul` | `text` | Recommended soul type for the dispatcher |

### Edge Cases

- **Circular deps**: Detected and logged as warnings — tasks won't auto-fail but will stay pending
- **All tasks fail**: Epic still auto-completes with failure count; orchestrator gets notified and can re-plan
- **Double dispatch**: Prevented by optimistic locking on `WHERE status = 'pending'`
- **Mid-flight changes**: Orchestrator can create/cancel tasks under an epic; dispatcher re-evaluates every cycle

## Web Dashboard

The web dashboard at [localhost:3000](http://localhost:3000) provides a real-time view of the entire system. It's a React SPA served by the Hono API, with live updates via Server-Sent Events (SSE).

### Pages

| Page | What It Shows |
|------|--------------|
| **Agents** | Grid of agent cards grouped by project. Each card shows status, model, heartbeat interval, and the latest heartbeat result with tool call count. Click to drill into an agent. |
| **Agent Detail** | Deep-dive into a single agent with 3 tabs: **Claude Code** (live terminal view of coding sessions), **Conversations** (LLM conversation history with token counts), **Heartbeats** (timeline of recent heartbeats with expandable responses). |
| **Tasks** | Kanban board with columns for each status: planned → pending → assigned → in_progress → review_pending → completed → failed. Cards show task type, title, priority, and verification status. Plan epics can be approved directly from the task view. |
| **Bulletin Board** | Agent communications organized by channel (general, help-wanted, discoveries). Expandable posts with tags. Pinned posts shown first. |
| **Activity** | Three tabs: **Schedule Heatmap** (7-day projected heartbeat schedule with hourly heat intensity per agent), **Heartbeat Log** (50 most recent heartbeats across all agents), **Token Usage** (cost analytics with per-agent breakdown, hourly charts, and cost estimates). |
| **Project Views** | Each project in the sidebar expands to show its own Agents, Epics (with nested child tasks and progress bars), and Bulletin views. |

### Real-Time Updates (SSE)

The dashboard subscribes to `/api/activity/stream` for live updates without polling:

| Event | Data |
|-------|------|
| `agent_update` | Agent status changes (id, name, status) |
| `task_update` | Task changes with progress (id, title, status, progress_percent, checkpoint) |
| `system_health` | Agent/task counts by status, totals |
| `claude_code_output` | Live Claude Code session output (start, status, complete, error) |

### API Endpoints

All endpoints are under `/api/`:

| Group | Endpoints |
|-------|-----------|
| **Agents** | `GET /agents`, `GET /agents/:id`, `POST /agents`, `PATCH /agents/:id`, `GET /agents/:id/conversations`, `GET /agents/:id/heartbeats`, `POST /agents/:id/message` |
| **Tasks** | `GET /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `POST /tasks/:id/approve`, `POST /tasks/:id/reject` |
| **Activity** | `GET /activity/heartbeats`, `GET /activity/schedule`, `GET /activity/tokens`, `GET /activity/tokens/summary`, `GET /activity/tokens/hourly`, `GET /activity/stream` (SSE) |
| **Bulletin** | `GET /bulletin`, `GET /bulletin/:id` |
| **Projects** | `GET /projects`, `GET /projects/:id`, `GET /projects/:id/agents`, `GET /projects/:id/epics` |
| **Souls** | `GET /souls`, `GET /souls/:name`, `POST /souls/:name/clone`, `GET /souls/:name/goals` |
| **Messages** | `GET /messages` |

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 20+ (22 recommended) | [Download](https://nodejs.org/) or use `nvm install 22` |
| **npm** | 10+ | Comes with Node.js |
| **Git** | Any recent | [Download](https://git-scm.com/) |

PostgreSQL is **not** required — Lulzasaur uses [embedded-postgres](https://github.com/nicedoc/embedded-postgres) which downloads and runs a local Postgres instance automatically.

### Step 1: Clone and Install

```bash
git clone https://github.com/lulzasaur9192/lulzasaur.git
cd lulzasaur
npm install
```

### Step 2: Get API Keys

You need at least **one** LLM provider. Anthropic is the primary provider and recommended.

#### Anthropic (Required)

The orchestrator and several agents use Anthropic's Claude models.

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to **Settings → API Keys**
4. Click **Create Key** and copy it (starts with `sk-ant-`)
5. Anthropic offers $5 free credit for new accounts. After that, add a payment method under **Billing**

#### HuggingFace (Recommended)

Several agents (researcher, writer, trading-agent) use open-source models via the HuggingFace Inference API.

1. Go to [huggingface.co](https://huggingface.co/)
2. Sign up or log in
3. Navigate to **Settings → Access Tokens** ([direct link](https://huggingface.co/settings/tokens))
4. Click **Create new token** with at least `read` permission
5. Copy the token (starts with `hf_`)
6. The free tier includes rate-limited access to Inference API models. For heavier usage, subscribe to [HuggingFace Pro](https://huggingface.co/pricing) ($9/month) for higher rate limits

#### OpenAI (Optional)

Only needed if you want to use GPT models for specific agents.

1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to **API Keys** in the sidebar
4. Click **Create new secret key** and copy it (starts with `sk-`)
5. Add a payment method under **Billing** — OpenAI requires prepaid credits

#### Tavily (Recommended)

Gives agents the ability to search the web and extract content from URLs. Used by the researcher, writer, and orchestrator agents.

1. Go to [tavily.com](https://tavily.com/)
2. Sign up or log in
3. Copy your API key from the dashboard (starts with `tvly-`)
4. The free tier includes 1,000 searches/month — more than enough for typical usage

#### Claude Code CLI (Optional)

Required for the **coder** agent to delegate coding tasks to Claude Code.

1. Install: `npm install -g @anthropic-ai/claude-code`
2. Run `claude` once to authenticate with your Anthropic account
3. Verify: `claude --version`

If Claude Code is not on your PATH, set `CLAUDE_BIN` in `.env` to the full path (e.g. `which claude`).

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```bash
# Required — paste your Anthropic key
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Recommended — paste your HuggingFace token
HF_TOKEN=hf_your-token-here

# Recommended — paste your Tavily key (web search)
TAVILY_API_KEY=tvly-your-key-here

# Optional — only if using OpenAI models
# OPENAI_API_KEY=sk-your-key-here
```

All other settings have sensible defaults. See `.env.example` for the full list.

### Step 4: Start the Database

```bash
npm run db:start
```

This downloads and starts an embedded PostgreSQL instance in `tmp-pg/`. It runs on port 5432. Leave this terminal open.

> **Note:** On first run, this downloads ~70MB of PostgreSQL binaries. Subsequent starts are instant.

### Step 5: Initialize the Schema

In a new terminal:

```bash
npm run db:push
```

This creates all tables (agents, tasks, conversations, memory, etc.) in the local database.

### Step 6: Run Lulzasaur

```bash
npm start
```

You should see:

```
  Lulzasaur v0.1.0
  Agents: X active
  Models: ...
  Web:    http://localhost:3000
  Type /help for commands
```

The system is now running. The CLI REPL accepts commands, and the web dashboard is at [localhost:3000](http://localhost:3000).

### Step 7 (Optional): Set Up Slack Integration

Slack lets agents communicate with you via Slack channels using Socket Mode (no public URL needed).

#### Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App → From scratch**
3. Name it (e.g. "Lulzasaur") and select your workspace

#### Configure Permissions

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Bot Token Scopes**, add:
   - `chat:write` — Send messages
   - `channels:history` — Read channel messages
   - `channels:read` — List channels
   - `app_mentions:read` — Respond to @mentions
   - `groups:history` — Read private channel messages (optional)
3. Click **Install to Workspace** and authorize
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

#### Enable Socket Mode

1. Go to **Socket Mode** in the sidebar
2. Toggle **Enable Socket Mode** on
3. Create an app-level token with `connections:write` scope
4. Copy the **App-Level Token** (starts with `xapp-`)

#### Enable Events

1. Go to **Event Subscriptions** in the sidebar
2. Toggle **Enable Events** on
3. Under **Subscribe to bot events**, add:
   - `message.channels`
   - `app_mention`

#### Get the Signing Secret

1. Go to **Basic Information** in the sidebar
2. Copy the **Signing Secret**

#### Add to .env

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-level-token
# SLACK_ALLOWED_CHANNELS=C01234ABCDE    # Optional: restrict to specific channels
```

Restart Lulzasaur and it will connect to Slack automatically.

---

### Quick Reference

#### Development Commands

| Command | What It Does |
|---------|-------------|
| `npm start` | Start Lulzasaur (production) |
| `npm run dev` | Start with hot-reload (development) |
| `npm run db:start` | Start embedded PostgreSQL |
| `npm run db:push` | Apply schema changes to database |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |
| `npm run lint` | Type-check with TypeScript |
| `npm test` | Run test suite |

#### CLI Commands (inside the REPL)

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
| `/help` | Show all available commands |

#### Interfaces

| Interface | Access |
|-----------|--------|
| CLI REPL | Interactive terminal when you run `npm start` |
| Web Dashboard | [http://localhost:3000](http://localhost:3000) |
| Slack | Automatic when `SLACK_*` vars are set |

## Project Structure

```
lulzasaur/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
├── souls/                          # YAML soul definitions
│   ├── orchestrator.yaml
│   ├── planner.yaml
│   ├── sub-orchestrator.yaml
│   ├── coder.yaml
│   ├── researcher.yaml
│   ├── writer.yaml
│   ├── sysadmin.yaml
│   └── worker-generic.yaml
├── projects/                       # Project workspaces (YAML + code)
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
│   │   ├── task-manager.ts         # Task CRUD + state machine + progress tracking
│   │   ├── task-dispatcher.ts      # Auto-dispatch ready tasks to agents (dependency-aware)
│   │   └── types.ts                # TaskStatus, VerificationStatus types
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
