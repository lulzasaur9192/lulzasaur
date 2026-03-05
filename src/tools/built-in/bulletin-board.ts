import { eq, desc, and, or, isNull, gte } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { bulletinBoard, agents, projects } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { isSlackConnected, getSlackApp, getSlackBotToken } from "../../integrations/slack-ref.js";
import { getProjectChannels, getSystemChannelId, postToChannel } from "../../integrations/slack-channels.js";

// ── Post to the board ──────────────────────────────────────────────

registerTool({
  name: "post_bulletin",
  description:
    "Post a message to the shared bulletin board that ALL agents can read. " +
    "Use for: sharing discoveries, requesting help, announcing status, " +
    "coordinating with other agents, or leaving notes for agents that " +
    "haven't been spawned yet. Channels: 'general', 'help-wanted', " +
    "'discoveries', 'status-updates'.",
  capability: "bulletin_board",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short headline for the post",
      },
      body: {
        type: "string",
        description: "Full message content",
      },
      channel: {
        type: "string",
        enum: ["general", "help-wanted", "discoveries", "status-updates"],
        description: "Channel to post in (default: general)",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for discovery (e.g. ['coding', 'api', 'bug'])",
      },
      pinned: {
        type: "boolean",
        description: "Pin this post (orchestrators only — ignored for other agents).",
      },
    },
    required: ["title", "body"],
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    // Auto-detect projectId from the posting agent
    let projectId: string | null = null;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (agent?.projectId) projectId = agent.projectId;

    // Only orchestrators can pin posts
    const isOrchestrator = agent?.name?.includes("orchestrator") ?? false;
    const pinned = isOrchestrator && input.pinned === true;

    const [post] = await db
      .insert(bulletinBoard)
      .values({
        authorAgentId: agentId,
        channel: input.channel ?? "general",
        title: input.title,
        body: input.body,
        tags: input.tags ?? [],
        pinned,
        projectId,
      })
      .returning();

    // Mirror to Slack if connected
    if (isSlackConnected()) {
      const slackApp = getSlackApp()!;
      const botToken = getSlackBotToken()!;
      const agentRow = agent;

      try {
        let targetChannelId: string | null = null;

        if (agentRow?.projectId) {
          const projectChannels = getProjectChannels(agentRow.projectId);
          if (projectChannels) {
            // Map bulletin channel → Slack channel
            const bulletinChannel = input.channel ?? "general";
            if (bulletinChannel === "discoveries" && projectChannels.has("research")) {
              targetChannelId = projectChannels.get("research")!;
            } else {
              targetChannelId = projectChannels.get("general") ?? null;
            }
          }
        }

        // Fall back to system channel for global posts
        if (!targetChannelId) {
          targetChannelId = getSystemChannelId();
        }

        if (targetChannelId) {
          const tags = (input.tags ?? []).length > 0 ? `\n_${(input.tags as string[]).join(", ")}_` : "";
          const text = `*[${input.channel ?? "general"}] ${input.title}*\n${input.body}\n_${agentRow?.name ?? "unknown"}_${tags}`;
          await postToChannel(slackApp, botToken, targetChannelId, text);
        }
      } catch {
        // Non-fatal: bulletin post succeeded, Slack mirror failed
      }
    }

    return {
      post_id: post!.id,
      channel: post!.channel,
      project_id: post!.projectId,
      message: "Posted to bulletin board. All agents will see this on their next heartbeat.",
    };
  },
});

// ── Read the board ─────────────────────────────────────────────────

registerTool({
  name: "read_bulletin",
  description:
    "Read recent posts from the shared bulletin board. Use on heartbeat " +
    "to see what other agents have shared — discoveries, help requests, " +
    "status updates. Filter by channel, tags, or project. " +
    "By default, project agents see their project's posts + global posts.",
  capability: "bulletin_board",
  inputSchema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Filter by channel (omit for all channels)",
      },
      tag: {
        type: "string",
        description: "Filter by tag",
      },
      project_id: {
        type: "string",
        description: "Filter by project ID (omit to see agent's project + global posts)",
      },
      limit: {
        type: "number",
        description: "Max posts to return (default: 10)",
      },
    },
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    const conditions = [];

    // Only show non-expired posts
    const now = new Date();
    conditions.push(
      or(isNull(bulletinBoard.expiresAt), gte(bulletinBoard.expiresAt, now))!,
    );

    if (input.channel) {
      conditions.push(eq(bulletinBoard.channel, input.channel));
    }

    // Project scoping: show project-specific + global posts
    if (input.project_id) {
      conditions.push(
        or(eq(bulletinBoard.projectId, input.project_id), isNull(bulletinBoard.projectId))!,
      );
    } else {
      // Auto-detect from agent
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      if (agent?.projectId) {
        conditions.push(
          or(eq(bulletinBoard.projectId, agent.projectId), isNull(bulletinBoard.projectId))!,
        );
      }
    }

    const limit = input.limit ?? 10;

    const posts = await db
      .select({
        post: bulletinBoard,
        author: agents,
      })
      .from(bulletinBoard)
      .leftJoin(agents, eq(bulletinBoard.authorAgentId, agents.id))
      .where(and(...conditions))
      .orderBy(desc(bulletinBoard.pinned), desc(bulletinBoard.createdAt))
      .limit(limit);

    // Filter by tag in-memory if specified
    let results = posts;
    if (input.tag) {
      results = posts.filter((p) =>
        (p.post.tags as string[]).includes(input.tag),
      );
    }

    return {
      count: results.length,
      posts: results.map((p) => ({
        id: p.post.id,
        author: p.author?.name ?? "unknown",
        channel: p.post.channel,
        title: p.post.title,
        body: p.post.body,
        tags: p.post.tags,
        pinned: p.post.pinned,
        project_id: p.post.projectId,
        posted_at: p.post.createdAt.toISOString(),
      })),
    };
  },
});

// ── Pin / Unpin (orchestrators only) ──────────────────────────────

registerTool({
  name: "pin_bulletin",
  description:
    "Pin or unpin a bulletin board post. Only orchestrators can use this. " +
    "Pinned posts appear at the top of the board for all agents.",
  capability: "bulletin_board",
  inputSchema: {
    type: "object",
    properties: {
      post_id: { type: "string", description: "The bulletin post ID to pin/unpin" },
      pinned: { type: "boolean", description: "true to pin, false to unpin" },
    },
    required: ["post_id", "pinned"],
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    // Check if the calling agent is an orchestrator
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!agent?.name?.includes("orchestrator")) {
      return { error: "Only orchestrators can pin/unpin bulletin posts." };
    }

    const [post] = await db
      .select()
      .from(bulletinBoard)
      .where(eq(bulletinBoard.id, input.post_id))
      .limit(1);

    if (!post) {
      return { error: `Post not found: ${input.post_id}` };
    }

    await db
      .update(bulletinBoard)
      .set({ pinned: input.pinned })
      .where(eq(bulletinBoard.id, input.post_id));

    return {
      post_id: input.post_id,
      pinned: input.pinned,
      message: input.pinned ? "Post pinned." : "Post unpinned.",
    };
  },
});
