import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-http");

interface HttpRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_ms?: number;
}

registerTool({
  name: "http_request",
  description: "Make an HTTP request. Returns status, headers, and body.",
  capability: "http_request",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to request" },
      method: { type: "string", description: "HTTP method (default: GET)" },
      headers: { type: "object", description: "Request headers" },
      body: { type: "string", description: "Request body (for POST/PUT/PATCH)" },
      timeout_ms: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
    },
    required: ["url"],
  },
  execute: async (_agentId: string, input: unknown) => {
    const { url, method, headers, body, timeout_ms } = input as HttpRequestInput;
    log.debug({ url, method: method ?? "GET" }, "Making HTTP request");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeout_ms ?? 30000);

      const response = await fetch(url, {
        method: method ?? "GET",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseBody = await response.text();

      return {
        status: response.status,
        status_text: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody.slice(0, 50000),
        truncated: responseBody.length > 50000,
      };
    } catch (err) {
      return { error: `HTTP request failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
