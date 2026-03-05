import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-file");

// ── file_read ──────────────────────────────────────────────────────

registerTool({
  name: "file_read",
  description: "Read the contents of a file. Returns the file content as a string.",
  capability: "file_read",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      max_bytes: { type: "number", description: "Maximum bytes to read (default: 100000)" },
    },
    required: ["path"],
  },
  execute: async (_agentId: string, input: unknown) => {
    const { path, max_bytes } = input as { path: string; max_bytes?: number };
    log.debug({ path }, "Reading file");
    try {
      const content = await readFile(path, "utf-8");
      const limit = max_bytes ?? 100000;
      return {
        content: content.slice(0, limit),
        truncated: content.length > limit,
        size_bytes: content.length,
      };
    } catch (err) {
      return { error: `Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ── file_write ─────────────────────────────────────────────────────

registerTool({
  name: "file_write",
  description: "Write content to a file. Creates the file and any parent directories if they don't exist.",
  capability: "file_write",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      content: { type: "string", description: "Content to write" },
      append: { type: "boolean", description: "Append instead of overwrite (default: false)" },
    },
    required: ["path", "content"],
  },
  execute: async (_agentId: string, input: unknown) => {
    const { path, content, append } = input as { path: string; content: string; append?: boolean };
    log.debug({ path, append }, "Writing file");
    try {
      await mkdir(dirname(path), { recursive: true });
      if (append) {
        const existing = await readFile(path, "utf-8").catch(() => "");
        await writeFile(path, existing + content, "utf-8");
      } else {
        await writeFile(path, content, "utf-8");
      }
      return { success: true, path, bytes_written: Buffer.byteLength(content) };
    } catch (err) {
      return { error: `Failed to write ${path}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ── file_list ──────────────────────────────────────────────────────

registerTool({
  name: "file_list",
  description: "List files and directories in a given path.",
  capability: "file_list",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
      recursive: { type: "boolean", description: "List recursively (default: false)" },
    },
    required: ["path"],
  },
  execute: async (_agentId: string, input: unknown) => {
    const { path: dirPath, recursive } = input as { path: string; recursive?: boolean };
    log.debug({ path: dirPath, recursive }, "Listing files");
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const results: { name: string; type: string; size?: number }[] = [];

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const type = entry.isDirectory() ? "directory" : "file";
        let size: number | undefined;

        if (entry.isFile()) {
          try {
            const s = await stat(fullPath);
            size = s.size;
          } catch { /* ignore */ }
        }

        results.push({ name: entry.name, type, size });

        if (recursive && entry.isDirectory()) {
          try {
            const subEntries = await readdir(fullPath, { withFileTypes: true });
            for (const sub of subEntries) {
              results.push({
                name: `${entry.name}/${sub.name}`,
                type: sub.isDirectory() ? "directory" : "file",
              });
            }
          } catch { /* ignore permission errors */ }
        }
      }

      return { entries: results, count: results.length };
    } catch (err) {
      return { error: `Failed to list ${dirPath}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
