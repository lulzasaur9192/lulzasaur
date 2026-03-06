import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
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

    // Create project directory under modules/
    const config = getConfig();
    const modulesDir =
      config.MODULES_DIR ??
      (import.meta.dirname
        ? join(import.meta.dirname, "..", "..", "..", "modules")
        : join(process.cwd(), "modules"));
    const projectDir = join(modulesDir, name);

    try {
      await mkdir(projectDir, { recursive: true });
      await mkdir(join(projectDir, "souls"), { recursive: true });
    } catch {
      // Directory may already exist, that's fine
    }

    const [project] = await db
      .insert(projects)
      .values({
        name,
        displayName,
        description: params.description ?? null,
        path: projectDir,
      })
      .returning();

    log.info(
      { projectId: project!.id, name, createdBy: agentId },
      "Project created",
    );

    return {
      project_id: project!.id,
      name: project!.name,
      display_name: project!.displayName,
      path: projectDir,
    };
  },
});
