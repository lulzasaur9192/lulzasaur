import { eq, and, or, isNull, gte, sql, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { knowledgeEntities, knowledgeRelations, agents } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";

// ── kg_traverse — BFS graph traversal from an entity ──────────────

registerTool({
  name: "kg_traverse",
  description:
    "Traverse the knowledge graph starting from a named entity. " +
    "Follows relationships via BFS up to N hops (max 3). " +
    "Use this to discover connected knowledge — find one thing, " +
    "follow its connections to discover everything related.",
  capability: "knowledge_graph",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the starting entity",
      },
      entity_id: {
        type: "string",
        description: "ID of the starting entity (alternative to name)",
      },
      depth: {
        type: "number",
        description: "Max hops to traverse (1-3, default: 2)",
      },
      relation_types: {
        type: "array",
        items: { type: "string" },
        description: "Only follow these relation types (omit for all)",
      },
      min_strength: {
        type: "number",
        description: "Only follow relations with strength >= this value",
      },
      direction: {
        type: "string",
        enum: ["outgoing", "incoming", "both"],
        description: "Direction to traverse (default: both)",
      },
    },
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    // Find start entity
    let startEntity;
    if (input.entity_id) {
      const [found] = await db
        .select()
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.id, input.entity_id))
        .limit(1);
      startEntity = found;
    } else if (input.name) {
      // Scope to agent's project
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      const nameConditions = [eq(knowledgeEntities.name, input.name)];
      if (agent?.projectId) {
        nameConditions.push(
          or(eq(knowledgeEntities.projectId, agent.projectId), isNull(knowledgeEntities.projectId))!,
        );
      }
      const [found] = await db
        .select()
        .from(knowledgeEntities)
        .where(and(...nameConditions))
        .limit(1);
      startEntity = found;
    }

    if (!startEntity) {
      return { error: "Entity not found", name: input.name, entity_id: input.entity_id };
    }

    const maxDepth = Math.min(input.depth ?? 2, 3);
    const direction = input.direction ?? "both";
    const PER_HOP_LIMIT = 20;

    // BFS
    const visited = new Set<string>([startEntity.id]);
    const nodes: Array<{
      entity_id: string;
      name: string;
      entity_type: string;
      content: string;
      confidence: number;
      depth: number;
    }> = [{
      entity_id: startEntity.id,
      name: startEntity.name,
      entity_type: startEntity.entityType,
      content: startEntity.content,
      confidence: startEntity.confidence,
      depth: 0,
    }];
    const edges: Array<{
      from: string;
      to: string;
      relation_type: string;
      strength: number;
      context: string | null;
      direction: string;
    }> = [];

    let frontier = [startEntity.id];

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextFrontier: string[] = [];

      for (const nodeId of frontier) {
        // Outgoing relations
        if (direction === "outgoing" || direction === "both") {
          const outConditions = [eq(knowledgeRelations.sourceEntityId, nodeId)];
          if (input.relation_types?.length) {
            outConditions.push(
              or(...input.relation_types.map((rt: string) => eq(knowledgeRelations.relationType, rt)))!,
            );
          }
          if (input.min_strength) {
            outConditions.push(gte(knowledgeRelations.strength, input.min_strength));
          }

          const outRels = await db
            .select({
              relation: knowledgeRelations,
              target: knowledgeEntities,
            })
            .from(knowledgeRelations)
            .innerJoin(knowledgeEntities, eq(knowledgeRelations.targetEntityId, knowledgeEntities.id))
            .where(and(...outConditions))
            .limit(PER_HOP_LIMIT);

          for (const r of outRels) {
            edges.push({
              from: nodeId,
              to: r.target.id,
              relation_type: r.relation.relationType,
              strength: r.relation.strength,
              context: r.relation.context,
              direction: "outgoing",
            });

            if (!visited.has(r.target.id)) {
              visited.add(r.target.id);
              nodes.push({
                entity_id: r.target.id,
                name: r.target.name,
                entity_type: r.target.entityType,
                content: r.target.content,
                confidence: r.target.confidence,
                depth,
              });
              nextFrontier.push(r.target.id);
            }
          }
        }

        // Incoming relations
        if (direction === "incoming" || direction === "both") {
          const inConditions = [eq(knowledgeRelations.targetEntityId, nodeId)];
          if (input.relation_types?.length) {
            inConditions.push(
              or(...input.relation_types.map((rt: string) => eq(knowledgeRelations.relationType, rt)))!,
            );
          }
          if (input.min_strength) {
            inConditions.push(gte(knowledgeRelations.strength, input.min_strength));
          }

          const inRels = await db
            .select({
              relation: knowledgeRelations,
              source: knowledgeEntities,
            })
            .from(knowledgeRelations)
            .innerJoin(knowledgeEntities, eq(knowledgeRelations.sourceEntityId, knowledgeEntities.id))
            .where(and(...inConditions))
            .limit(PER_HOP_LIMIT);

          for (const r of inRels) {
            edges.push({
              from: r.source.id,
              to: nodeId,
              relation_type: r.relation.relationType,
              strength: r.relation.strength,
              context: r.relation.context,
              direction: "incoming",
            });

            if (!visited.has(r.source.id)) {
              visited.add(r.source.id);
              nodes.push({
                entity_id: r.source.id,
                name: r.source.name,
                entity_type: r.source.entityType,
                content: r.source.content,
                confidence: r.source.confidence,
                depth,
              });
              nextFrontier.push(r.source.id);
            }
          }
        }
      }

      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    // Track access on all visited entities
    const visitedIds = [...visited];
    if (visitedIds.length > 0) {
      await db
        .update(knowledgeEntities)
        .set({
          accessCount: sql`${knowledgeEntities.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(inArray(knowledgeEntities.id, visitedIds));
    }

    return {
      start: { entity_id: startEntity.id, name: startEntity.name },
      nodes,
      edges,
    };
  },
});
