/**
 * Restarts WhatsApp connection by:
 * 1. Checking session status
 * 2. Providing QR code if needed  
 * 3. Verifying connection
 */
import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { existsSync, unlinkSync, readdirSync } from "node:fs";

loadDotenv();

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";

const authDir = join(process.env.HOME ?? "~", ".openclaw/credentials/whatsapp/default");

console.log("=== WhatsApp Connection Manager ===\n");

async function restart() {
  console.log("1. Loading authentication state...");
  
  if (!existsSync(join(authDir, "creds.json"))) {
    console.log("   ❌ No credentials found - need initial setup");
    console.log("   → Run the main app, it will show QR code on first start");
    process.exit(1);
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  
  console.log("   ✅ Credentials loaded\n");
  
  console.log("2. Attempting connection...");
  console.log("   (This may take up to 20 seconds)\n");
  
  // Silent logger
  const noop = () => {};
  const silentLogger: any = {
    level: "silent",
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => silentLogger,
  };
  
  const sock = makeWASocket({
    auth: state,
    browser: ["Lulzasaur", "Desktop", "1.0.0"],
    logger: silentLogger,
    printQRInTerminal: true, // Show QR if needed
  });
  
  sock.ev.on("creds.update", saveCreds);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log("\n   ⏱️  Connection timeout");
      sock.end(undefined);
      reject(new Error("Timeout"));
    }, 20000);
    
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log("\n📱 QR Code generated - scan with your phone!\n");
      }
      
      if (connection === "close") {
        clearTimeout(timeout);
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        
        if (statusCode === DisconnectReason.loggedOut) {
          console.log("\n   ❌ Session is LOGGED OUT");
          console.log("\n   To fix:");
          console.log("   1. Delete credentials: rm -rf " + authDir);
          console.log("   2. Restart main app to get new QR code");
          console.log("   3. Scan QR with your phone\n");
          reject(new Error("Logged out"));
        } else if (statusCode === 405) {
          console.log("\n   ⚠️  Connection conflict (405)");
          console.log("\n   This usually means:");
          console.log("   • Another WhatsApp Web session is active");
          console.log("   • The main Lulzasaur app is already connected (this is normal!)");
          console.log("\n   If messages aren't working:");
          console.log("   1. Check main app logs for errors");
          console.log("   2. Restart the main Lulzasaur app");
          console.log("   3. Check WhatsApp Web on phone - logout other sessions\n");
          resolve(true);
        } else {
          console.log(`\n   ❌ Connection failed: ${statusCode}`);
          reject(new Error(`Status: ${statusCode}`));
        }
      }
      
      if (connection === "connecting") {
        console.log("   🔄 Connecting...");
      }
      
      if (connection === "open") {
        clearTimeout(timeout);
        const jid = sock.user?.id;
        const phone = jid?.split(":")[0] ?? "unknown";
        
        console.log("\n   ✅ WhatsApp CONNECTED!");
        console.log(`   📱 Phone: +${phone}`);
        console.log(`   🆔 JID: ${jid}\n`);
        
        console.log("3. Sending test message...");
        const allowedNumbers = process.env.WHATSAPP_ALLOWED_NUMBERS?.split(",") ?? [];
        
        if (allowedNumbers.length > 0) {
          const testNumber = allowedNumbers[0];
          const targetJid = `${testNumber.replace(/\D/g, "")}@s.whatsapp.net`;
          
          try {
            await sock.sendMessage(targetJid, {
              text: `✅ WhatsApp connection restored!\n\nTimestamp: ${new Date().toLocaleString()}\n\nYour Lulzasaur agent notifications should now work correctly.`
            });
            console.log(`   ✅ Test message sent to ${testNumber}\n`);
          } catch (e) {
            console.log(`   ❌ Send failed: ${e instanceof Error ? e.message : String(e)}\n`);
          }
        }
        
        sock.end(undefined);
        resolve(true);
      }
    });
  });
}

restart()
  .then(() => {
    console.log("=== Success ===");
    console.log("WhatsApp connection is working!");
    console.log("\nNext: Restart the main Lulzasaur app to ensure it picks up the connection.");
    process.exit(0);
  })
  .catch((error) => {
    console.log("\n=== Failed ===");
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
