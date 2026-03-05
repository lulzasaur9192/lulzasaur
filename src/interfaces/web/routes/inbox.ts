import { Hono } from "hono";
import { getInboxItems, getPendingCount, respondToInboxItem } from "../../../inbox/user-inbox.js";

export const inboxRoutes = new Hono();

// List inbox items (with optional filters)
inboxRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const type = c.req.query("type");
  const limit = c.req.query("limit");

  const items = await getInboxItems({
    status: status || undefined,
    type: type || undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  });

  return c.json(items);
});

// Get pending count (for badge)
inboxRoutes.get("/count", async (c) => {
  const pending = await getPendingCount();
  return c.json({ pending });
});

// Respond to an inbox item
inboxRoutes.post("/:id/respond", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const { action, message } = body;

  if (!action || !["approve", "reject", "dismiss", "reply"].includes(action)) {
    return c.json({ error: "Invalid action. Must be: approve, reject, dismiss, or reply" }, 400);
  }

  const result = await respondToInboxItem(id, action, message);

  if ("error" in result) {
    return c.json(result, 400);
  }

  return c.json(result);
});
