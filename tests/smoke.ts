/**
 * Smoke test: verifies the full Phase 1 stack works end-to-end.
 * Requires Postgres running on localhost:5432.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { loadConfig } from "../src/config/index.js";
import { getDb, closeDb } from "../src/db/client.js";
import { syncSoulsFromDirectory } from "../src/core/soul.js";
import { createAgent, getAgent, getActiveConversation, listAgents } from "../src/core/agent-registry.js";
import { initializeDefaultProviders } from "../src/llm/registry.js";
import { runAgentTurn } from "../src/core/agent-runtime.js";
import { join } from "node:path";

// Register tools
import "../src/tools/index.js";

import {
  soulDefinitions,
  agents,
  tasks,
  messages,
  conversations,
  agentMemory,
  heartbeatLog,
} from "../src/db/schema.js";

async function smoke() {
  console.log("=== Lulzasaur Smoke Test ===\n");

  // 1. Config
  console.log("1. Loading config...");
  const config = loadConfig();
  console.log(`   ✓ Config loaded (provider: ${config.DEFAULT_LLM_PROVIDER})`);

  // 2. Database
  console.log("\n2. Connecting to database...");
  const db = getDb();

  // Push schema
  const { execSync } = await import("node:child_process");
  execSync("npx drizzle-kit push --force", {
    cwd: join(import.meta.dirname ?? process.cwd(), ".."),
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
  });
  console.log("   ✓ Schema pushed");

  // 3. Soul sync
  console.log("\n3. Syncing souls...");
  const soulsDir = join(import.meta.dirname ?? process.cwd(), "..", "souls");
  await syncSoulsFromDirectory(soulsDir);
  const soulRows = await db.select().from(soulDefinitions);
  console.log(`   ✓ ${soulRows.length} souls synced: ${soulRows.map((s) => s.name).join(", ")}`);

  // 4. LLM providers
  console.log("\n4. Initializing LLM providers...");
  initializeDefaultProviders();
  console.log("   ✓ Providers initialized");

  // 5. Agent creation
  console.log("\n5. Creating test agent...");
  const agent = await createAgent({
    name: "smoke-test-orchestrator",
    soulName: "main-orchestrator",
    depth: 1,
  });
  console.log(`   ✓ Agent created: ${agent.id} (${agent.name})`);

  // 6. Verify conversation exists
  console.log("\n6. Checking conversation...");
  const conv = await getActiveConversation(agent.id);
  console.log(`   ✓ Active conversation: ${conv?.id} (${conv?.messages?.length ?? 0} messages)`);

  // 7. Run an agent turn (requires API key)
  if (config.ANTHROPIC_API_KEY) {
    console.log("\n7. Running agent turn with LLM...");
    try {
      const result = await runAgentTurn(agent.id, "Say hello and list your available tools in a brief sentence.");
      console.log(`   ✓ Response: ${result.response.slice(0, 200)}`);
      console.log(`   ✓ Tool calls: ${result.toolCalls.length}`);
      console.log(`   ✓ Tokens: ${result.tokenUsage.totalTokens}`);
      console.log(`   ✓ Duration: ${result.durationMs}ms`);

      // Verify conversation was persisted
      const updatedConv = await getActiveConversation(agent.id);
      console.log(`   ✓ Conversation now has ${updatedConv?.messages?.length ?? 0} messages`);
    } catch (error) {
      console.log(`   ✗ LLM call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log("\n7. Skipping LLM test (no ANTHROPIC_API_KEY set)");
  }

  // 8. Verify DB state
  console.log("\n8. Verifying database state...");
  const agentList = await listAgents();
  const convList = await db.select().from(conversations);
  console.log(`   ✓ Agents in DB: ${agentList.length}`);
  console.log(`   ✓ Conversations in DB: ${convList.length}`);

  // 9. Clean up
  console.log("\n9. Cleaning up...");
  await closeDb();
  console.log("   ✓ Database connection closed");

  console.log("\n=== Smoke Test Complete ===");
}

smoke().catch((error) => {
  console.error("\n❌ Smoke test failed:", error);
  process.exit(1);
});
