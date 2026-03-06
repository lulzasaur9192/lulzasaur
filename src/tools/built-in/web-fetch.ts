import { tavily } from "@tavily/core";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-web-fetch");

interface WebFetchInput {
  urls: string[];
  format?: "markdown" | "text";
}

registerTool({
  name: "web_fetch",
  description:
    "Extract clean content from one or more web pages. Returns the page text in markdown or plain text format, " +
    "stripping ads, navigation, and boilerplate. Use web_search to find URLs first, then web_fetch to read them.",
  capability: "web_search",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "URLs to extract content from (max 5)",
      },
      format: {
        type: "string",
        enum: ["markdown", "text"],
        description: "Output format (default: markdown)",
      },
    },
    required: ["urls"],
  },
  execute: async (_agentId: string, input: unknown) => {
    const params = input as WebFetchInput;
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return { error: "TAVILY_API_KEY not set. Get one at https://tavily.com" };
    }

    const urls = params.urls.slice(0, 5);
    log.debug({ urls, format: params.format }, "Web fetch");

    try {
      const client = tavily({ apiKey });
      const response = await client.extract(urls, {
        format: params.format ?? "markdown",
      });

      return {
        results: response.results.map((r) => ({
          url: r.url,
          title: r.title,
          content: r.rawContent.slice(0, 50000),
          truncated: r.rawContent.length > 50000,
        })),
        failed: response.failedResults.map((r) => ({
          url: r.url,
          error: r.error,
        })),
        response_time_ms: Math.round(response.responseTime * 1000),
      };
    } catch (err) {
      return { error: `Web fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
