// Must load dotenv BEFORE any project imports (which may trigger loadConfig)
import { config } from "dotenv";
config();

async function main() {
  const { loadConfig } = await import("../src/config/index.js");
  const { SlackAdapter } = await import("../src/interfaces/chat-adapters/slack.js");

  const c = loadConfig();

  console.log("=== Slack Diagnostic ===");
  console.log("SLACK_BOT_TOKEN set:", !!c.SLACK_BOT_TOKEN);
  console.log("SLACK_APP_TOKEN set:", !!c.SLACK_APP_TOKEN);
  console.log("SLACK_SIGNING_SECRET set:", !!c.SLACK_SIGNING_SECRET);
  console.log("SLACK_ALLOWED_CHANNELS:", c.SLACK_ALLOWED_CHANNELS ?? "(empty)");

  if (!c.SLACK_BOT_TOKEN || !c.SLACK_APP_TOKEN) {
    console.error("\nMISSING TOKENS - adapter would NOT start");
    console.log("process.env.SLACK_BOT_TOKEN:", process.env.SLACK_BOT_TOKEN ? "SET" : "EMPTY");
    console.log("process.env.SLACK_APP_TOKEN:", process.env.SLACK_APP_TOKEN ? "SET" : "EMPTY");
    process.exit(1);
  }

  console.log("\nCreating adapter...");
  const slack = new SlackAdapter({
    botToken: c.SLACK_BOT_TOKEN,
    signingSecret: c.SLACK_SIGNING_SECRET ?? "",
    appToken: c.SLACK_APP_TOKEN,
    allowedChannels: c.SLACK_ALLOWED_CHANNELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
  });

  console.log("Connecting (Socket Mode)...");
  try {
    await slack.start();
    console.log("Connected!");
  } catch (e: any) {
    console.error("START FAILED:", e.message ?? String(e));
    if (e.data) console.error("Error data:", JSON.stringify(e.data, null, 2));
    process.exit(1);
  }

  const channels = c.SLACK_ALLOWED_CHANNELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (channels.length === 0) {
    console.log("\nNo SLACK_ALLOWED_CHANNELS set - cannot send test message.");
    console.log("But adapter connected OK. Try DMing the bot in Slack.");
  } else {
    console.log("\nSending test message to channels:", channels);
    for (const ch of channels) {
      try {
        await slack.sendMessage(ch, "Test message from Lulzasaur diagnostic script");
        console.log(`  ${ch}: SENT OK`);
      } catch (e: any) {
        console.error(`  ${ch}: FAILED -`, e.message ?? String(e));
        if (e.data) console.error("  Error data:", JSON.stringify(e.data, null, 2));
      }
    }
  }

  await slack.stop();
  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
