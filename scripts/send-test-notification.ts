/**
 * Sends a test notification using the message_user tool to verify WhatsApp delivery
 */
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { getDb } from "../src/db/client.js";
import { createAgent, listAgents } from "../src/core/agent-registry.js";
import { runAgentTurn } from "../src/core/agent-runtime.js";
import { initializeDefaultProviders } from "../src/llm/registry.js";
import "../src/tools/index.js"; // Register all tools

console.log("=== Testing WhatsApp Notification Delivery ===\n");

async function test() {
  // Initialize
  initializeDefaultProviders();
  
  // Get or create a test agent
  const agents = await listAgents({ status: "idle" });
  let testAgent = agents.find(a => a.name === "whatsapp-test-agent");
  
  if (!testAgent) {
    console.log("Creating test agent...");
    testAgent = await createAgent({
      name: "whatsapp-test-agent",
      soulName: "main-orchestrator",
      depth: 1,
    });
  }
  
  console.log(`Using agent: ${testAgent.name} (${testAgent.id})\n`);
  
  // Send test message using message_user tool
  console.log("Sending test notification via message_user tool...");
  
  const prompt = `Use the message_user tool to send an alert with this exact message: "🧪 WhatsApp Test - ${new Date().toLocaleTimeString()}: If you receive this on WhatsApp, the integration is working!"`;
  
  const result = await runAgentTurn(testAgent.id, prompt);
  
  console.log("\nAgent Response:");
  console.log(result.response);
  console.log(`\nTool Calls: ${result.toolCalls.length}`);
  
  if (result.toolCalls.length > 0) {
    console.log("Tools used:", result.toolCalls.map(tc => tc.name).join(", "));
    const messageUserCall = result.toolCalls.find(tc => tc.name === "message_user");
    if (messageUserCall) {
      console.log("\n✅ message_user tool was called");
      console.log("Result:", JSON.stringify(messageUserCall.result, null, 2));
    }
  }
  
  console.log("\n=== Test Complete ===");
  console.log("Check your WhatsApp to see if you received the message!");
}

test()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
