import { eq, and, or, isNull, ilike, gte, desc, count, sql, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { knowledgeEntities, knowledgeRelations, agents } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";

// ── kg_search — find entities by filters ──────────────────────────

registerTool({
  name: "kg_search",
  description:
    "Search your knowledge graph for entities. Filter by name, type, tags, " +
    "content text, author agent, or minimum confidence. Returns entities with " +
    "relationship counts. You see your project's entities + global entities.",
  capability: "knowledge_graph",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Substring match on entity name (case-insensitive)",
      },
      entity_type: {
        type: "string",
        enum: ["project", "decision", "research", "lesson", "preference", "person", "system", "concept"],
        description: "Filter by entity type",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Filter by tags (entities must have ALL specified tags)",
      },
      text: {
        type: "string",
        description: "Substring match in content (case-insensitive)",
      },
      agent_name: {
        type: "string",
        description: "Filter by author agent name",
      },
      min_confidence: {
        type: "number",
        description: "Minimum confidence score (0-100)",
      },
      limit: {
        type: "number",
        description: "Max results (default: 10)",
      },
      include_other_agents: {
        type: "boolean",
        description: "Search entities from all agents in your project (default: false, only yours)",
      },
    },
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    const conditions = [];

    // Project scoping — same pattern as bulletin board
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (agent?.projectId) {
      conditions.push(
        or(eq(knowledgeEntities.projectId, agent.projectId), isNull(knowledgeEntities.projectId))!,
      );
    }

    // Unless include_other_agents is true, scope to this agent only
    if (!input.include_other_agents) {
      conditions.push(eq(knowledgeEntities.agentId, agentId));
    }

    if (input.name) {
      conditions.push(ilike(knowledgeEntities.name, `%${input.name}%`));
    }

    if (input.entity_type) {
      conditions.push(eq(knowledgeEntities.entityType, input.entity_type));
    }

    if (input.text) {
      conditions.push(ilike(knowledgeEntities.content, `%${input.text}%`));
    }

    if (input.min_confidence) {
      conditions.push(gte(knowledgeEntities.confidence, input.min_confidence));
    }

    const limit = input.limit ?? 10;

    // If filtering by agent name, join on agents
    if (input.agent_name) {
      conditions.push(ilike(agents.name, `%${input.agent_name}%`));
    }

    const rows = await db
      .select({
        entity: knowledgeEntities,
        authorName: agents.name,
      })
      .from(knowledgeEntities)
      .leftJoin(agents, eq(knowledgeEntities.agentId, agents.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(knowledgeEntities.updatedAt))
      .limit(limit);

    // Filter by tags in-memory (jsonb array containment)
    let results = rows;
    if (input.tags && Array.isArray(input.tags) && input.tags.length > 0) {
      results = rows.filter((r) => {
        const entityTags = r.entity.tags as string[];
        return input.tags.every((t: string) => entityTags.includes(t));
      });
    }

    // Get relation counts for each entity
    const entities = await Promise.all(
      results.map(async (r) => {
        const [outgoing] = await db
          .select({ count: count() })
          .from(knowledgeRelations)
          .where(eq(knowledgeRelations.sourceEntityId, r.entity.id));

        const [incoming] = await db
          .select({ count: count() })
          .from(knowledgeRelations)
          .where(eq(knowledgeRelations.targetEntityId, r.entity.id));

        return {
          id: r.entity.id,
          name: r.entity.name,
          entity_type: r.entity.entityType,
          content: r.entity.content,
          confidence: r.entity.confidence,
          tags: r.entity.tags,
          author: r.authorName ?? "unknown",
          outgoing_relations: outgoing!.count,
          incoming_relations: incoming!.count,
          updated_at: r.entity.updatedAt.toISOString(),
        };
      }),
    );

    // Track access for relevance scoring
    const entityIds = entities.map((e) => e.id);
    if (entityIds.length > 0) {
      await db
        .update(knowledgeEntities)
        .set({
          accessCount: sql`${knowledgeEntities.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(inArray(knowledgeEntities.id, entityIds));
    }

    return { count: entities.length, entities };
  },
});
