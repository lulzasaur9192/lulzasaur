import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { readFileSync } from "fs";
import { resolve } from "path";
import { agentRoutes } from "./routes/agents.js";
import { taskRoutes } from "./routes/tasks.js";
import { messageRoutes } from "./routes/messages.js";
import { activityRoutes } from "./routes/activity.js";
import { soulRoutes } from "./routes/souls.js";
import { bulletinRoutes } from "./routes/bulletin.js";
import { projectRoutes } from "./routes/projects.js";
import { trashRoutes } from "./routes/trash.js";
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
  app.route("/api/trash", trashRoutes);
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

let _dashboardJsCache: string | null = null;
function dashboardJs(): string {
  if (!_dashboardJsCache) {
    try {
      _dashboardJsCache = readFileSync(
        resolve(process.cwd(), "dist/dashboard.js"),
        "utf-8"
      );
    } catch {
      return "// Dashboard bundle not built yet. Run: npm run build:dashboard";
    }
  }
  return _dashboardJsCache;
}
