import { tavily } from "@tavily/core";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-web-search");

interface WebSearchInput {
  query: string;
  topic?: "general" | "news" | "finance";
  max_results?: number;
  include_answer?: boolean;
  time_range?: "day" | "week" | "month" | "year";
  include_domains?: string[];
  exclude_domains?: string[];
}

registerTool({
  name: "web_search",
  description:
    "Search the web using Tavily. Returns relevant results with titles, URLs, and content snippets. " +
    "Use topic='news' for recent events, topic='finance' for market/financial data.",
  capability: "web_search",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      topic: { type: "string", enum: ["general", "news", "finance"], description: "Search topic (default: general)" },
      max_results: { type: "number", description: "Max results to return (default: 5, max: 10)" },
      include_answer: { type: "boolean", description: "Include an AI-generated answer summary (default: true)" },
      time_range: { type: "string", enum: ["day", "week", "month", "year"], description: "Limit results to this time range" },
      include_domains: { type: "array", items: { type: "string" }, description: "Only include results from these domains" },
      exclude_domains: { type: "array", items: { type: "string" }, description: "Exclude results from these domains" },
    },
    required: ["query"],
  },
  execute: async (_agentId: string, input: unknown) => {
    const params = input as WebSearchInput;
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return { error: "TAVILY_API_KEY not set. Get one at https://tavily.com" };
    }

    log.debug({ query: params.query, topic: params.topic }, "Web search");

    try {
      const client = tavily({ apiKey });
      const response = await client.search(params.query, {
        topic: params.topic ?? "general",
        maxResults: Math.min(params.max_results ?? 5, 10),
        includeAnswer: params.include_answer !== false,
        timeRange: params.time_range,
        includeDomains: params.include_domains,
        excludeDomains: params.exclude_domains,
        searchDepth: "basic",
      });

      return {
        query: response.query,
        answer: response.answer ?? null,
        results: response.results.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          score: r.score,
          published_date: r.publishedDate ?? null,
        })),
        response_time_ms: Math.round(response.responseTime * 1000),
      };
    } catch (err) {
      return { error: `Web search failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
