// Post directly to #all-lulzasaur channel
import { config } from "dotenv";
config();

async function main() {
  const { loadConfig } = await import("../src/config/index.js");
  const { WebClient } = await import("@slack/web-api");

  const c = loadConfig();

  if (!c.SLACK_BOT_TOKEN) {
    console.error("Missing SLACK_BOT_TOKEN");
    process.exit(1);
  }

  const client = new WebClient(c.SLACK_BOT_TOKEN);

  console.log("=== Posting to #all-lulzasaur ===\n");

  // Try multiple approaches
  const attempts = [
    { name: "Channel name", channel: "all-lulzasaur" },
    { name: "With #", channel: "#all-lulzasaur" },
    { name: "Configured ID", channel: "C0AHVUD239R" }
  ];

  for (const attempt of attempts) {
    console.log(`Trying: ${attempt.name} (${attempt.channel})...`);
    try {
      const result = await client.chat.postMessage({
        channel: attempt.channel,
        text: "Test from Lulzasaur agents"
      });
      console.log(`✅ SUCCESS! Message posted via ${attempt.name}`);
      console.log(`   Timestamp: ${result.ts}`);
      console.log(`   Channel: ${result.channel}`);
      process.exit(0);
    } catch (e: any) {
      console.log(`❌ Failed: ${e.data?.error || e.message}\n`);
    }
  }

  console.error("\n⚠️  ALL ATTEMPTS FAILED");
  console.error("\nPossible solutions:");
  console.error("1. Invite the bot to #all-lulzasaur:");
  console.error("   - Go to #all-lulzasaur channel");
  console.error("   - Type: /invite @lulzasaur");
  console.error("2. Check if C0AHVUD239R is the correct channel ID");
  console.error("3. Ensure bot has 'chat:write' permission");
  process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
