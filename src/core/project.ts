import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { projects, soulDefinitions, agents } from "../db/schema.js";
import { soulSchema } from "./types.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("project");

interface ProjectDefinition {
  name: string;
  display_name: string;
  description?: string;
  config?: Record<string, unknown>;
}

/**
 * Scan modules directory for project.yaml files and upsert to projects table.
 * Pattern mirrors syncSoulsFromDirectory in soul.ts.
 */
export async function syncProjectsFromDirectory(modulesDir: string): Promise<void> {
  const db = getDb();
  const syncedNames = new Set<string>();

  let dirs: string[];
  try {
    dirs = await readdir(modulesDir, { withFileTypes: true })
      .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    log.warn({ modulesDir }, "Modules directory not found, skipping project sync");
    return;
  }

  for (const dir of dirs) {
    const projectFile = join(modulesDir, dir, "project.yaml");
    let raw: string;
    try {
      raw = await readFile(projectFile, "utf-8");
    } catch {
      log.debug({ dir }, "No project.yaml found, skipping");
      continue;
    }

    const def = parseYaml(raw) as ProjectDefinition;
    if (!def.name) {
      log.warn({ dir }, "project.yaml missing 'name' field, skipping");
      continue;
    }

    const existing = await db
      .select()
      .from(projects)
      .where(eq(projects.name, def.name))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(projects)
        .set({
          displayName: def.display_name ?? def.name,
          description: def.description ?? null,
          path: dir,
          config: def.config ?? {},
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(projects.name, def.name));
      log.debug({ name: def.name }, "Updated project");
    } else {
      await db.insert(projects).values({
        name: def.name,
        displayName: def.display_name ?? def.name,
        description: def.description ?? null,
        path: dir,
        config: def.config ?? {},
      });
      log.debug({ name: def.name }, "Created project");
    }

    syncedNames.add(def.name);
  }

  // Deactivate projects whose directories no longer exist and terminate their agents
  const allDbProjects = await db.select().from(projects);
  for (const dbProject of allDbProjects) {
    if (!syncedNames.has(dbProject.name) && dbProject.active) {
      await db
        .update(projects)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(projects.id, dbProject.id));

      // Terminate all non-terminated agents for this project
      const projectAgents = await db
        .select()
        .from(agents)
        .where(eq(agents.projectId, dbProject.id));

      for (const agent of projectAgents) {
        if (agent.status !== "terminated") {
          await db
            .update(agents)
            .set({ status: "terminated" as any, updatedAt: new Date() })
            .where(eq(agents.id, agent.id));
        }
      }

      log.info({ name: dbProject.name }, "Deactivated project (directory removed) and terminated its agents");
    }
  }
}

/**
 * For each project, scan its souls/ directory and upsert to soulDefinitions with projectId set.
 * Soul names stay clean (e.g. "market-analyst"); uniqueness is scoped by (name, projectId).
 */
export async function syncProjectSouls(modulesDir: string): Promise<void> {
  const db = getDb();

  const activeProjects = await db.select().from(projects).where(eq(projects.active, true));

  for (const project of activeProjects) {
    const soulsDir = join(modulesDir, project.path, "souls");
    let files: string[];
    try {
      files = (await readdir(soulsDir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    } catch {
      log.debug({ project: project.name }, "No souls/ directory found for project");
      continue;
    }

    for (const file of files) {
      const filePath = join(soulsDir, file);
      const raw = await readFile(filePath, "utf-8");
      const parsed = parseYaml(raw);
      const soul = soulSchema.parse(parsed);

      // Look for existing soul with same name AND same projectId
      const existing = await db
        .select()
        .from(soulDefinitions)
        .where(
          and(
            eq(soulDefinitions.name, soul.name),
            eq(soulDefinitions.projectId, project.id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(soulDefinitions)
          .set({
            purpose: soul.purpose,
            intent: soul.intent ?? null,
            goals: soul.goals,
            capabilities: soul.capabilities,
            personality: soul.personality ?? null,
            constraints: soul.constraints ?? null,
            defaultModel: soul.default_model ?? null,
            contextBudget: soul.context_budget,
            heartbeatIntervalSeconds: soul.heartbeat_interval_seconds ?? null,
            persistent: soul.persistent,
            rawYaml: raw,
            projectId: project.id,
            updatedAt: new Date(),
          })
          .where(eq(soulDefinitions.id, existing[0]!.id));
        log.debug({ name: soul.name, project: project.name }, "Updated project soul");
      } else {
        await db.insert(soulDefinitions).values({
          name: soul.name,
          purpose: soul.purpose,
          intent: soul.intent ?? null,
          goals: soul.goals,
          capabilities: soul.capabilities,
          personality: soul.personality ?? null,
          constraints: soul.constraints ?? null,
          defaultModel: soul.default_model ?? null,
          contextBudget: soul.context_budget,
          heartbeatIntervalSeconds: soul.heartbeat_interval_seconds ?? null,
          persistent: soul.persistent,
          rawYaml: raw,
          projectId: project.id,
        });
        log.debug({ name: soul.name, project: project.name }, "Created project soul");
      }
    }
  }
}

/**
 * Get a project by name slug.
 */
export async function getProjectByName(name: string) {
  const db = getDb();
  const results = await db
    .select()
    .from(projects)
    .where(eq(projects.name, name))
    .limit(1);
  return results[0] ?? null;
}

/**
 * Get a project by ID.
 */
export async function getProjectById(id: string) {
  const db = getDb();
  const results = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return results[0] ?? null;
}

/**
 * List all active projects.
 */
export async function listProjects() {
  const db = getDb();
  return db.select().from(projects).where(eq(projects.active, true));
}

/**
 * Get all persistent souls that belong to a project.
 */
export async function getProjectPersistentSouls(projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(soulDefinitions)
    .where(
      and(
        eq(soulDefinitions.projectId, projectId),
        eq(soulDefinitions.persistent, true),
      ),
    );
}
