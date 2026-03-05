import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { soulDefinitions } from "../db/schema.js";
import { soulSchema, type SoulDefinition } from "./types.js";
import { getConfig } from "../config/index.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("soul");

export async function loadSoulFromFile(filePath: string): Promise<SoulDefinition> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = parseYaml(raw);
  return soulSchema.parse(parsed);
}

export async function syncSoulsFromDirectory(soulsDir: string): Promise<void> {
  const db = getDb();
  let files: string[];
  try {
    files = (await readdir(soulsDir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    log.warn({ soulsDir }, "Souls directory not found, skipping sync");
    return;
  }

  for (const file of files) {
    const filePath = join(soulsDir, file);
    const soul = await loadSoulFromFile(filePath);
    const rawYaml = await readFile(filePath, "utf-8");

    const existing = await db
      .select()
      .from(soulDefinitions)
      .where(eq(soulDefinitions.name, soul.name))
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
          defaultProvider: soul.default_provider ?? null,
          maxToolIterations: soul.max_tool_iterations ?? null,
          contextBudget: soul.context_budget,
          heartbeatIntervalSeconds: soul.heartbeat_interval_seconds ?? null,
          schedules: soul.schedules ?? null,
          persistent: soul.persistent,
          rawYaml,
          updatedAt: new Date(),
        })
        .where(eq(soulDefinitions.name, soul.name));
      log.debug({ name: soul.name }, "Updated soul definition");
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
        defaultProvider: soul.default_provider ?? null,
        contextBudget: soul.context_budget,
        heartbeatIntervalSeconds: soul.heartbeat_interval_seconds ?? null,
        schedules: soul.schedules ?? null,
        persistent: soul.persistent,
        rawYaml,
      });
      log.debug({ name: soul.name }, "Created soul definition");
    }
  }
}

export async function getSoulByName(name: string) {
  const db = getDb();
  const results = await db
    .select()
    .from(soulDefinitions)
    .where(eq(soulDefinitions.name, name))
    .limit(1);
  return results[0] ?? null;
}

/**
 * Clone a soul definition under a new name, optionally overriding fields.
 * This is the "duplicate & remix" pattern — take a working agent, tweak it.
 */
export async function cloneSoul(
  sourceName: string,
  newName: string,
  overrides?: Partial<{
    intent: string;
    purpose: string;
    goals: string[];
    capabilities: string[];
    personality: string;
    constraints: string;
  }>,
) {
  const db = getDb();
  const source = await getSoulByName(sourceName);
  if (!source) throw new Error(`Soul "${sourceName}" not found`);

  // Check if target name already exists
  const existing = await getSoulByName(newName);
  if (existing) throw new Error(`Soul "${newName}" already exists`);

  const [cloned] = await db
    .insert(soulDefinitions)
    .values({
      name: newName,
      purpose: overrides?.purpose ?? source.purpose,
      intent: overrides?.intent ?? source.intent,
      goals: overrides?.goals ?? (source.goals as string[]),
      capabilities: overrides?.capabilities ?? (source.capabilities as string[]),
      personality: overrides?.personality ?? source.personality,
      constraints: overrides?.constraints ?? source.constraints,
      defaultModel: source.defaultModel,
      defaultProvider: source.defaultProvider,
      maxToolIterations: source.maxToolIterations,
      contextBudget: source.contextBudget,
      heartbeatIntervalSeconds: source.heartbeatIntervalSeconds,
      persistent: source.persistent,
    })
    .returning();

  log.info({ source: sourceName, clone: newName }, "Soul cloned");
  return cloned!;
}

export function buildSystemPrompt(soul: {
  name: string;
  purpose: string;
  intent?: string | null;
  goals?: string[];
  personality: string | null;
  constraints: string | null;
  capabilities: string[];
}, project?: {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  config?: Record<string, unknown> | null;
} | null): string {
  const parts: string[] = [
    `You are "${soul.name}".`,
  ];

  // Intent goes first — it's the single most important thing
  if (soul.intent) {
    parts.push("", `## Intent`, soul.intent);
  }

  parts.push("", `## Purpose`, soul.purpose);

  // Goals are explicit, measurable KPIs
  if (soul.goals && soul.goals.length > 0) {
    parts.push("", `## Goals (Your Success Metrics)`, soul.goals.map((g) => `- ${g}`).join("\n"));
    parts.push("Every action you take should advance one or more of these goals. If an action doesn't serve a goal, don't do it.");
  }

  if (soul.personality) {
    parts.push("", `## Personality`, soul.personality);
  }

  if (soul.constraints) {
    parts.push("", `## Constraints`, soul.constraints);
  }

  if (soul.capabilities.length > 0) {
    parts.push("", `## Available Capabilities`, soul.capabilities.map((c) => `- ${c}`).join("\n"));
  }

  // Inject project context if agent belongs to a project
  if (project) {
    parts.push(
      "",
      `## Project: ${project.displayName}`,
      `You belong to the "${project.name}" project (ID: ${project.id}).`,
    );
    if (project.description) {
      parts.push(project.description);
    }
    if (project.config && Object.keys(project.config).length > 0) {
      parts.push(`Project config: ${JSON.stringify(project.config)}`);
    }
    parts.push(
      "When creating tasks or bulletin posts, they will be automatically scoped to this project.",
      "You can see posts from your project and from the global scope.",
    );
  }

  // Inject modules directory so agents know where to put work
  const config = getConfig();
  const modulesDir = config.MODULES_DIR
    ?? (import.meta.dirname ? join(import.meta.dirname, "..", "..", "modules") : join(process.cwd(), "modules"));
  parts.push(
    "",
    "## Workspace",
    `All project work should be created under: ${modulesDir}`,
    "Each project gets its own subdirectory (e.g. modules/my-project/).",
  );

  // Only include system interfaces section if agent has user-facing capabilities
  if (soul.capabilities.includes("message_user") || soul.capabilities.includes("request_user_review")) {
    parts.push(
      "",
      "## System Interfaces",
      "Active: CLI, Web (localhost:3000), Slack (if configured).",
      "message_user and request_user_review deliver to ALL active interfaces.",
    );
  }

  parts.push(
    "",
    "## Rules",
    "- Use tools to do work, not just describe it. Use complete_task with results when done.",
    "- Never claim done without verification. Query for info — don't assume.",
  );

  parts.push(
    "",
    "## Memory",
    "You have persistent memory that survives context compaction. USE IT.",
    "",
    "### Core Memory Blocks (always in context):",
    "Your core memory blocks (persona, learned_preferences, working_context, domain_knowledge) are always",
    "visible to you at the end of this system prompt. Update them with update_memory_block.",
    "- persona: Your self-understanding. Update as you learn about your role and approach.",
    "- learned_preferences: User/project preferences you discover. Coding style, conventions, tool choices.",
    "- working_context: Your scratchpad — current state, pending work, blockers. Update frequently.",
    "- domain_knowledge: Key domain facts, architecture decisions, important patterns.",
    "",
    "### When to save:",
    "- Update working_context at the start and end of each task",
    "- Update learned_preferences when you discover user or project preferences",
    "- Update domain_knowledge when you learn important facts about the system",
    "- Use kg_store for structured knowledge with relationships — decisions, lessons, research",
    "- Use write_memory for quick key-value notes",
    "",
    "### When to recall:",
    "- Your memory blocks are already in context — check them first",
    "- Before starting any task: kg_search for prior attempts or related knowledge",
    "- Use reflect periodically to extract learnings from your conversation into memory blocks",
    "",
    "### Tool choice:",
    "- update_memory_block: update your core memory blocks (always in context)",
    "- reflect: analyze recent conversation and get suggestions for memory updates",
    "- write_memory / read_memory: quick key-value notes",
    "- kg_store: structured knowledge with relationships — decisions, lessons, research",
    "- kg_search: find what you or other agents have learned (use include_other_agents for cross-agent)",
    "- kg_traverse: explore connections from a known entity",
    "",
    "Do not rely on conversation context alone — it gets compacted. What you don't save, you will forget.",
  );

  return parts.join("\n");
}
