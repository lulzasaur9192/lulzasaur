# Projects / Modules System

Lulzasaur supports long-lived **projects** — self-contained modules that define their own agents, scoped tasks (epics/stories), and project-specific bulletin boards. All managed by the single global orchestrator.

## Directory Structure

Projects live in the `modules/` directory at the repo root:

```
modules/
├── prop-shop/
│   ├── project.yaml          # Project definition (required)
│   └── souls/                # Project-specific agent definitions
│       ├── market-analyst.yaml
│       └── trade-executor.yaml
├── content-pipeline/
│   ├── project.yaml
│   └── souls/
│       └── content-writer.yaml
└── ...
```

## Creating a Project

### 1. Create the directory

```bash
mkdir -p modules/my-project/souls
```

### 2. Define `project.yaml`

```yaml
name: my-project              # Unique slug (used as ID, must be unique)
display_name: My Project       # Human-readable name (shown in UI)
description: >                 # Optional description
  What this project does and why it exists.
```

The `name` field must be a unique slug — it's the primary key for the project. Use kebab-case.

### 3. Add soul definitions

Create YAML files in `modules/my-project/souls/`. These follow the exact same format as global souls in `souls/`:

```yaml
# modules/my-project/souls/my-agent.yaml
name: my-agent
purpose: "What this agent does within the project"
intent: "Core directive / prime objective"
goals:
  - "Measurable KPI 1"
  - "Measurable KPI 2"
capabilities:
  - "create_task"
  - "query_tasks"
  - "bulletin_board"
  - "message_user"
  - "shell_exec"
  - "file_ops"
personality: "Behavioral style description"
constraints: "Hard boundaries the agent must respect"
default_model: "claude-sonnet-4-5"     # Optional, defaults to system default
context_budget: 150000                  # Optional, defaults to 150k tokens
heartbeat_interval_seconds: 300         # null = no heartbeat
persistent: true                        # true = long-lived, false = one-shot
```

**Key points:**
- Soul names within a project stay clean (e.g., `market-analyst`, not `prop-shop/market-analyst`)
- Uniqueness is scoped by `(name, projectId)` — a project soul can share the same name as a global soul
- Project souls with `persistent: true` get their agent auto-created at boot

### 4. Restart Lulzasaur

```bash
npm start
```

On boot, Lulzasaur will:
1. Scan `modules/*/project.yaml` and upsert to the `projects` table
2. Scan `modules/*/souls/*.yaml` and upsert to `soul_definitions` with `projectId` set
3. Create agents for all persistent project souls

## How Projects Work

### Scoping

Projects add a `projectId` foreign key to:
- **Agents** — know which project they belong to
- **Tasks** — scoped to a project; epics group related tasks
- **Bulletin posts** — project agents auto-tag their posts
- **Soul definitions** — project souls are linked to their project

Everything is **backwards-compatible** — `projectId` is nullable. Global agents/tasks/posts have `projectId = null`.

### Task Types: Epics & Tasks

Tasks now have a `type` field: `"task"` (default) or `"epic"`.

- **Epic**: A high-level container that groups related tasks. Create an epic, then create child tasks with `parent_task_id` pointing to the epic.
- **Task**: A concrete work unit (the default, same as before).

Agents can create epics via the `create_task` tool:
```
create_task({ title: "Build trading engine", type: "epic", project_id: "..." })
```

Then create subtasks under it:
```
create_task({ title: "Implement order routing", parent_task_id: "<epic-id>" })
```

### Auto-detection

When a project agent creates a task or bulletin post, the `projectId` is **automatically detected** from the agent — no need to specify it manually. The tools look up the creating agent's `projectId` and apply it.

### Bulletin Board Scoping

- **Project agents** see: their project's posts + global (no-project) posts
- **Global agents** see: all posts (no project filter)
- The `read_bulletin` tool accepts an optional `project_id` filter
- The `post_bulletin` tool auto-tags posts with the agent's `projectId`

### Heartbeat Context

Project agents receive additional context in their heartbeat and system prompts:
- Project name, description, and config are injected
- "You belong to project X" context helps agents stay focused

### Web Dashboard

The dashboard sidebar splits into:
- **System** section: Chat, Agents, Tasks, Bulletin, Activity (global views)
- **Projects** section: Collapsible tree, each project expands to show Agents, Epics, Bulletin

Project views are filtered — clicking "Prop Shop > Epics" shows only that project's epics with progress bars and nested child tasks.

## API Endpoints

### Projects
```
GET  /api/projects              — List all projects
GET  /api/projects/:id          — Project detail with agent/task counts
GET  /api/projects/:id/agents   — Project's agents
GET  /api/projects/:id/epics    — Project's epics with nested child tasks + progress
```

### Existing endpoints (now with project filters)
```
GET  /api/tasks?projectId=X&type=epic    — Filter tasks by project and/or type
GET  /api/bulletin?projectId=X           — Filter bulletin by project
```

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `MODULES_DIR` | `{cwd}/modules` | Path to the modules directory |

## Example: Prop Shop Trading Project

```yaml
# modules/prop-shop/project.yaml
name: prop-shop
display_name: Prop Shop Trading
description: Automated proprietary trading system with market analysis
```

```yaml
# modules/prop-shop/souls/market-analyst.yaml
name: market-analyst
purpose: "Analyze market data and identify trading opportunities"
intent: "Find profitable trades by analyzing price action, volume, and market sentiment"
goals:
  - "Identify at least 3 actionable trading signals per analysis cycle"
  - "Maintain >60% signal accuracy over rolling 30-day window"
capabilities:
  - "create_task"
  - "query_tasks"
  - "bulletin_board"
  - "http_request"
  - "file_ops"
  - "shell_exec"
  - "message_user"
personality: "Analytical, data-driven, cautious. Prefers statistical evidence over intuition."
constraints: "Never recommend trades without supporting data. Always include risk assessment."
heartbeat_interval_seconds: 300
persistent: true
```

## What Does NOT Change

- **Heartbeat scheduler** — already global, polls all agents
- **Message system** — agent-to-agent messaging is orthogonal to projects
- **LLM providers** — unrelated to project scoping
- **Chat adapters** (Slack) — talk to the global orchestrator
- **Context compaction** — agent-scoped, not project-scoped
