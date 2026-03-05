import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { existsSync } from "node:fs";

loadDotenv();

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";

const authDir = join(process.env.HOME ?? "~", ".openclaw/credentials/whatsapp/default");
const allowedNumbers = process.env.WHATSAPP_ALLOWED_NUMBERS?.split(",") ?? [];

console.log("=== WhatsApp Diagnostic Test ===\n");

// 1. Check credentials
console.log("1. Checking credentials...");
const credsPath = join(authDir, "creds.json");
if (!existsSync(credsPath)) {
  console.log(`   ❌ No credentials found at ${credsPath}`);
  console.log(`   → Run WhatsApp setup first`);
  process.exit(1);
}
console.log(`   ✅ Credentials exist: ${credsPath}`);

// 2. Check allowed numbers
console.log("\n2. Checking configuration...");
console.log(`   Allowed numbers: ${allowedNumbers.length > 0 ? allowedNumbers.join(", ") : "(all numbers allowed)"}`);

// 3. Initialize WhatsApp client
console.log("\n3. Initializing WhatsApp client...");

async function test() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Create silent logger
  const noop = () => {};
  const silentLogger: any = {
    level: "silent",
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => silentLogger,
  };

  const sock = makeWASocket({
    auth: state,
    browser: ["Lulzasaur-Test", "Desktop", "1.0.0"],
    logger: silentLogger,
  });

  sock.ev.on("creds.update", saveCreds);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sock.end(undefined);
      reject(new Error("Connection timeout after 30 seconds"));
    }, 30000);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        clearTimeout(timeout);
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(`   ❌ WhatsApp is LOGGED OUT`);
          console.log(`   → Need to re-authenticate (scan QR code)`);
          reject(new Error("Logged out"));
        } else {
          console.log(`   ❌ Connection closed: ${statusCode ?? "unknown reason"}`);
          reject(new Error(`Connection closed: ${statusCode}`));
        }
      }

      if (connection === "open") {
        clearTimeout(timeout);
        const selfJid = sock.user?.id ?? null;
        const selfNumber = selfJid?.replace("@s.whatsapp.net", "").replace(":.*", "");
        
        console.log(`   ✅ WhatsApp CONNECTED`);
        console.log(`   📱 Phone: ${selfNumber}`);
        console.log(`   🆔 JID: ${selfJid}`);

        // Test sending message if allowed numbers configured
        if (allowedNumbers.length > 0) {
          console.log("\n4. Testing message send...");
          const testNumber = allowedNumbers[0];
          const jid = `${testNumber.replace(/\\D/g, "")}@s.whatsapp.net`;
          
          try {
            await sock.sendMessage(jid, { 
              text: "✅ WhatsApp diagnostic test successful!\n\nThis is an automated test message from your Lulzasaur agent system." 
            });
            console.log(`   ✅ Test message sent to ${testNumber}`);
          } catch (e) {
            console.log(`   ❌ Failed to send test message: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        sock.end(undefined);
        resolve(true);
      }
    });
  });
}

test()
  .then(() => {
    console.log("\n=== Diagnostic Complete ===");
    console.log("WhatsApp integration is working correctly!");
    process.exit(0);
  })
  .catch((error) => {
    console.log(`\n=== Diagnostic Failed ===`);
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
