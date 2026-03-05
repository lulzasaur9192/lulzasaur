// Test posting to #all-lulzasaur channel
import { config } from "dotenv";
config();

async function main() {
  const { loadConfig } = await import("../src/config/index.js");
  const { SlackAdapter } = await import("../src/interfaces/chat-adapters/slack.js");
  const { WebClient } = await import("@slack/web-api");

  const c = loadConfig();

  if (!c.SLACK_BOT_TOKEN || !c.SLACK_APP_TOKEN) {
    console.error("Missing Slack tokens");
    process.exit(1);
  }

  const client = new WebClient(c.SLACK_BOT_TOKEN);

  console.log("=== Finding #all-lulzasaur channel ===");
  
  try {
    // List all channels the bot can see
    const result = await client.conversations.list({
      types: "public_channel,private_channel",
      limit: 200
    });

    const channels = result.channels || [];
    console.log(`Found ${channels.length} channels`);
    
    // Find #all-lulzasaur
    const targetChannel = channels.find((ch: any) => ch.name === "all-lulzasaur");
    
    if (!targetChannel) {
      console.log("\nAvailable channels:");
      channels.forEach((ch: any) => {
        console.log(`  #${ch.name} (${ch.id}) ${ch.is_member ? "[MEMBER]" : "[NOT MEMBER]"}`);
      });
      console.error("\n❌ Channel #all-lulzasaur not found");
      process.exit(1);
    }

    console.log(`\n✅ Found: #${targetChannel.name} (${targetChannel.id})`);
    console.log(`   Bot is member: ${targetChannel.is_member ? "YES" : "NO"}`);

    // Try to join if not a member
    if (!targetChannel.is_member) {
      console.log("\nAttempting to join channel...");
      try {
        await client.conversations.join({ channel: targetChannel.id });
        console.log("✅ Joined channel!");
      } catch (e: any) {
        console.error("❌ Could not join:", e.message);
        console.error("\n⚠️  MANUAL ACTION REQUIRED:");
        console.error("   Please invite the bot to #all-lulzasaur by typing:");
        console.error("   /invite @lulzasaur");
        console.error("   in the #all-lulzasaur channel");
        process.exit(1);
      }
    }

    // Post test message
    console.log("\n📤 Posting test message to #all-lulzasaur...");
    const postResult = await client.chat.postMessage({
      channel: targetChannel.id,
      text: "Test from Lulzasaur agents"
    });

    console.log("✅ Message posted successfully!");
    console.log(`   Timestamp: ${postResult.ts}`);

  } catch (e: any) {
    console.error("Error:", e.message);
    if (e.data) console.error(JSON.stringify(e.data, null, 2));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
