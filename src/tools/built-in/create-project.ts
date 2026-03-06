import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { syncProjectSouls } from "../../core/project.js";
import { createChildLogger } from "../../utils/logger.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { stringify as stringifyYaml } from "yaml";
import { getConfig } from "../../config/index.js";

const log = createChildLogger("tool-create-project");

interface CreateProjectInput {
  name: string;
  display_name?: string;
  description?: string;
}

registerTool({
  name: "create_project",
  description:
    "Create a new project. Projects group related agents, tasks, and epics together. " +
    "They appear in the dashboard sidebar under their own section. " +
    "Use a short kebab-case name (e.g. 'micro-saas', 'content-pipeline').",
  capability: "create_project",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Short kebab-case project identifier (e.g. 'micro-saas'). Must be unique.",
      },
      display_name: {
        type: "string",
        description:
          "Human-readable project name (e.g. 'Micro-SaaS Exploration'). Defaults to titleized name.",
      },
      description: {
        type: "string",
        description: "Brief description of the project's purpose.",
      },
    },
    required: ["name"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const params = input as CreateProjectInput;

    // Normalize name to kebab-case
    const name = params.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    // Check if project already exists
    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.name, name))
      .limit(1);

    if (existing) {
      return {
        project_id: existing.id,
        name: existing.name,
        display_name: existing.displayName,
        already_existed: true,
      };
    }

    // Derive display name
    const displayName =
      params.display_name ??
      name
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

    // Create project directory under projects/
    const config = getConfig();
    const projectsDir =
      config.PROJECTS_DIR ??
      (import.meta.dirname
        ? join(import.meta.dirname, "..", "..", "..", "projects")
        : join(process.cwd(), "projects"));
    const projectDir = join(projectsDir, name);

    try {
      await mkdir(projectDir, { recursive: true });
      await mkdir(join(projectDir, "souls"), { recursive: true });
    } catch {
      // Directory may already exist, that's fine
    }

    // Write project.yaml so the project survives restarts (syncProjectsFromDirectory reads this)
    const projectYaml: Record<string, unknown> = {
      name,
      display_name: displayName,
    };
    if (params.description) {
      projectYaml.description = params.description;
    }
    await writeFile(
      join(projectDir, "project.yaml"),
      stringifyYaml(projectYaml),
      "utf-8",
    );

    // Scaffold default soul YAMLs so the project has agents ready to use
    const soulsDir = join(projectDir, "souls");
    const defaultSouls = [
      {
        filename: "orchestrator.yaml",
        content: {
          name: `${name}-orchestrator`,
          intent: `Coordinate all work for the ${displayName} project`,
          purpose: `You are the project orchestrator for ${displayName}. ${params.description ?? ""}
Coordinate sub-agents (researcher, coder), break work into tasks,
verify results, and report progress to the main orchestrator.`,
          goals: [
            "Complete project objectives on time",
            "Keep sub-agents productive — no stalled or orphaned tasks",
            "Escalate blockers and decisions to main-orchestrator promptly",
          ],
          capabilities: [
            "create_task", "query_tasks", "query_agents", "spawn_agent",
            "send_message", "bulletin_board", "request_user_review", "system_health",
          ],
          personality: "Organized and proactive. Keeps work moving, escalates fast.",
          constraints: `- Stay within the scope of this project
- Delegate implementation to the coder agent, research to the researcher agent
- Report completion with structured results via request_user_review
- Use get_system_health to check agent/task status`,
          default_model: "claude-haiku-4-5-20251001",
          default_provider: "anthropic",
          context_budget: 120000,
          heartbeat_interval_seconds: 1800,
          persistent: true,
        },
      },
      {
        filename: "researcher.yaml",
        content: {
          name: `${name}-researcher`,
          intent: `Research and gather information for the ${displayName} project`,
          purpose: `You are the researcher for ${displayName}. Gather information from the web,
APIs, and files. Produce structured, actionable findings with sources.`,
          goals: [
            "Find accurate, relevant information for research questions",
            "Cite sources for every claim",
            "Produce structured findings — not vague summaries",
          ],
          capabilities: [
            "web_search", "http_request", "file_read", "file_write",
            "request_user_review", "update_task_progress", "query_tasks",
          ],
          personality: "Thorough and evidence-driven. Always cites sources.",
          constraints: `- Always cite the source URL or file for every piece of information
- If information is uncertain, say so explicitly
- Write findings to a file in the project directory so they persist
- Report progress on active tasks using update_task_progress`,
          default_model: "claude-haiku-4-5-20251001",
          default_provider: "anthropic",
          context_budget: 100000,
          persistent: false,
        },
      },
      {
        filename: "coder.yaml",
        content: {
          name: `${name}-coder`,
          intent: `Implement and maintain code for the ${displayName} project`,
          purpose: `You are the coder for ${displayName}. Research existing code before making changes,
spec out changes in detail, delegate to Claude Code, verify output, and submit for review.`,
          goals: [
            "Produce working code that passes tests/builds",
            "Follow existing project conventions",
            "Always research before coding — never guess at project structure",
          ],
          capabilities: [
            "claude_code", "file_read", "file_list", "shell_exec",
            "request_user_review", "update_task_progress", "query_tasks",
          ],
          personality: "Senior engineering lead. Specs first, codes second.",
          constraints: `- ALWAYS read existing code before sending anything to Claude Code
- Set working_directory for every Claude Code call to the project directory
- Use plan mode first for any non-trivial change
- NEVER call complete_task directly — always use request_user_review
- Report progress on active tasks using update_task_progress`,
          default_model: "claude-haiku-4-5-20251001",
          default_provider: "anthropic",
          context_budget: 100000,
          persistent: false,
        },
      },
    ];

    for (const soul of defaultSouls) {
      await writeFile(
        join(soulsDir, soul.filename),
        stringifyYaml(soul.content),
        "utf-8",
      );
    }

    const [project] = await db
      .insert(projects)
      .values({
        name,
        displayName,
        description: params.description ?? null,
        path: name, // relative dir name — syncProjectsFromDirectory joins this with projectsDir
      })
      .returning();

    // Sync the new soul YAMLs into the DB so they're immediately available for spawn_agent
    await syncProjectSouls(projectsDir);

    log.info(
      { projectId: project!.id, name, createdBy: agentId },
      "Project created with default souls",
    );

    return {
      project_id: project!.id,
      name: project!.name,
      display_name: project!.displayName,
      path: projectDir,
      souls_created: defaultSouls.map((s) => s.content.name),
    };
  },
});
