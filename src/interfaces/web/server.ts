import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { agentRoutes } from "./routes/agents.js";
import { taskRoutes } from "./routes/tasks.js";
import { messageRoutes } from "./routes/messages.js";
import { activityRoutes } from "./routes/activity.js";
import { soulRoutes } from "./routes/souls.js";
import { bulletinRoutes } from "./routes/bulletin.js";
import { projectRoutes } from "./routes/projects.js";
import { inboxRoutes } from "./routes/inbox.js";
import { dashboardHtml } from "./dashboard/index.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("web");

export function startWebServer(port: number, host: string) {
  const app = new Hono();

  app.use("*", cors());

  // API routes
  app.route("/api/agents", agentRoutes);
  app.route("/api/tasks", taskRoutes);
  app.route("/api/messages", messageRoutes);
  app.route("/api/activity", activityRoutes);
  app.route("/api/souls", soulRoutes);
  app.route("/api/bulletin", bulletinRoutes);
  app.route("/api/projects", projectRoutes);
  app.route("/api/inbox", inboxRoutes);

  // Dashboard — serve the SPA
  app.get("/", (c) => c.html(dashboardHtml()));
  app.get("/dashboard.js", (c) => {
    c.header("Content-Type", "application/javascript");
    return c.body(dashboardJs());
  });

  serve({ fetch: app.fetch, port, hostname: host }, () => {
    log.debug({ port, host }, "Web server started");
  });

  return app;
}

function dashboardJs(): string {
  // Inline the dashboard JS — no Vite build step needed for Phase 5
  return `// Dashboard JS loaded`;
}
