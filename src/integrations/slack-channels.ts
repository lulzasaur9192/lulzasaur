import type { App } from "@slack/bolt";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("slack-channels");

// In-memory cache: channelName → slackChannelId
const channelCache = new Map<string, string>();

// Project channel mappings: projectId → { purpose → slackChannelId }
const projectChannelMap = new Map<string, Map<string, string>>();

// Reverse mapping: slackChannelId → projectId
const channelToProjectMap = new Map<string, string>();

/**
 * Get channel ID by name, using cache or looking up via Slack API.
 */
export async function getChannelIdByName(
  app: App,
  botToken: string,
  name: string,
): Promise<string | null> {
  // Normalize: strip leading #
  const normalized = name.replace(/^#/, "");

  if (channelCache.has(normalized)) {
    return channelCache.get(normalized)!;
  }

  try {
    let cursor: string | undefined;
    do {
      const result = await app.client.conversations.list({
        token: botToken,
        types: "public_channel",
        limit: 200,
        cursor,
      });

      for (const channel of result.channels ?? []) {
        if (channel.name && channel.id) {
          channelCache.set(channel.name, channel.id);
        }
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (e) {
    log.warn({ error: String(e), name: normalized }, "Failed to list channels");
    return null;
  }

  return channelCache.get(normalized) ?? null;
}

/**
 * Ensure a channel exists, creating it if needed, and join it.
 */
async function ensureChannel(
  app: App,
  botToken: string,
  name: string,
): Promise<string | null> {
  const normalized = name.replace(/^#/, "");

  // Check cache/API for existing channel
  let channelId = await getChannelIdByName(app, botToken, normalized);

  if (!channelId) {
    // Create the channel
    try {
      const result = await app.client.conversations.create({
        token: botToken,
        name: normalized,
        is_private: false,
      });
      channelId = result.channel?.id ?? null;
      if (channelId) {
        channelCache.set(normalized, channelId);
        log.info({ name: normalized, channelId }, "Created Slack channel");
      }
    } catch (e: any) {
      // Channel may already exist (race condition) — "name_taken" error
      if (e?.data?.error === "name_taken") {
        channelId = await getChannelIdByName(app, botToken, normalized);
      } else {
        log.warn({ error: String(e), name: normalized }, "Failed to create Slack channel");
        return null;
      }
    }
  }

  if (channelId) {
    // Join the channel (in case bot isn't a member)
    try {
      await app.client.conversations.join({ token: botToken, channel: channelId });
    } catch (e: any) {
      // "already_in_channel" is fine
      if (e?.data?.error !== "already_in_channel") {
        log.debug({ error: String(e), name: normalized }, "Could not join channel (may already be in it)");
      }
    }
  }

  return channelId ?? null;
}

/**
 * Ensure all project channels exist. Returns map of purpose → slackChannelId.
 */
export async function ensureProjectChannels(
  app: App,
  botToken: string,
  project: { id: string; name: string; config?: Record<string, unknown> },
): Promise<Map<string, string>> {
  const channels = new Map<string, string>();

  // Check for explicit channel config in project
  const slackConfig = project.config?.slack_channels as Record<string, string> | undefined;

  const channelDefs: Record<string, string> = slackConfig ?? {
    general: project.name,
    alerts: `${project.name}-alerts`,
  };

  for (const [purpose, channelName] of Object.entries(channelDefs)) {
    const channelId = await ensureChannel(app, botToken, channelName);
    if (channelId) {
      channels.set(purpose, channelId);
      channelToProjectMap.set(channelId, project.id);
      log.debug({ project: project.name, purpose, channel: channelName, channelId }, "Project channel ready");
    }
  }

  projectChannelMap.set(project.id, channels);
  return channels;
}

/**
 * Ensure a system-level channel exists.
 */
export async function ensureSystemChannel(
  app: App,
  botToken: string,
  channelName: string,
): Promise<string | null> {
  return ensureChannel(app, botToken, channelName);
}

/**
 * Post a message to a Slack channel.
 */
export async function postToChannel(
  app: App,
  botToken: string,
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<string | null> {
  try {
    const result = await app.client.chat.postMessage({
      token: botToken,
      channel: channelId,
      text,
      thread_ts: threadTs,
    });
    return result.ts ?? null;
  } catch (e) {
    log.warn({ error: String(e), channelId }, "Failed to post to Slack channel");
    return null;
  }
}

/**
 * Get the project channel map for a given projectId.
 */
export function getProjectChannels(projectId: string): Map<string, string> | undefined {
  return projectChannelMap.get(projectId);
}

/**
 * Get projectId from a Slack channel ID (reverse lookup).
 */
export function getProjectIdFromChannel(channelId: string): string | undefined {
  return channelToProjectMap.get(channelId);
}

/**
 * Get channel-to-project mapping for all registered channels.
 */
export function getChannelToProjectMapping(): Map<string, string> {
  return new Map(channelToProjectMap);
}

// System channel ID cache
let systemChannelId: string | null = null;

export function getSystemChannelId(): string | null {
  return systemChannelId;
}

export function setSystemChannelId(id: string): void {
  systemChannelId = id;
}
