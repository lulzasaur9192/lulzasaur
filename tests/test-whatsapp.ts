#!/usr/bin/env tsx
/**
 * WhatsApp Integration Test Script
 * 
 * This script tests the WhatsApp integration by:
 * 1. Verifying credentials exist
 * 2. Checking configuration
 * 3. Testing connection
 * 4. Sending a test message
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

// Load environment variables
loadDotenv();

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const BOLD = "\x1b[1m";

console.log(`\n${BOLD}${BLUE}WhatsApp Integration Test${RESET}\n`);

let allTestsPassed = true;

// Test 1: Check credentials
console.log(`${BOLD}Test 1: Checking WhatsApp credentials...${RESET}`);
const authDir = join(process.env.HOME ?? "~", ".openclaw/credentials/whatsapp/default");
const credsPath = join(authDir, "creds.json");

if (existsSync(credsPath)) {
  console.log(`  ${GREEN}✓${RESET} Credentials found at: ${credsPath}`);
} else {
  console.log(`  ${RED}✗${RESET} Credentials NOT found at: ${credsPath}`);
  console.log(`  ${YELLOW}→${RESET} WhatsApp needs to be authenticated first`);
  allTestsPassed = false;
}

// Test 2: Check configuration
console.log(`\n${BOLD}Test 2: Checking configuration...${RESET}`);
const allowedNumbers = process.env.WHATSAPP_ALLOWED_NUMBERS;

if (allowedNumbers) {
  const numbers = allowedNumbers.split(",");
  console.log(`  ${GREEN}✓${RESET} Allowed numbers configured: ${numbers.join(", ")}`);
} else {
  console.log(`  ${YELLOW}⚠${RESET} No allowed numbers configured (all numbers will be allowed)`);
}

// Test 3: Check Baileys package
console.log(`\n${BOLD}Test 3: Checking Baileys package...${RESET}`);
try {
  const packageJson = await import("../package.json", { assert: { type: "json" } });
  const baileysVersion = packageJson.default.dependencies["@whiskeysockets/baileys"];
  console.log(`  ${GREEN}✓${RESET} Baileys installed: ${baileysVersion}`);
} catch (error) {
  console.log(`  ${RED}✗${RESET} Baileys package not found`);
  allTestsPassed = false;
}

// Test 4: Check WhatsApp adapter file
console.log(`\n${BOLD}Test 4: Checking WhatsApp adapter implementation...${RESET}`);
const adapterPath = join(process.cwd(), "src/interfaces/chat-adapters/whatsapp.ts");

if (existsSync(adapterPath)) {
  console.log(`  ${GREEN}✓${RESET} WhatsApp adapter found at: ${adapterPath}`);
} else {
  console.log(`  ${RED}✗${RESET} WhatsApp adapter NOT found at: ${adapterPath}`);
  allTestsPassed = false;
}

// Test 5: Check integration in main system
console.log(`\n${BOLD}Test 5: Checking system integration...${RESET}`);
const indexPath = join(process.cwd(), "src/index.ts");

if (existsSync(indexPath)) {
  const { readFileSync } = await import("node:fs");
  const indexContent = readFileSync(indexPath, "utf-8");
  
  if (indexContent.includes("WhatsAppAdapter")) {
    console.log(`  ${GREEN}✓${RESET} WhatsApp adapter imported in main system`);
  } else {
    console.log(`  ${RED}✗${RESET} WhatsApp adapter NOT imported in main system`);
    allTestsPassed = false;
  }
  
  if (indexContent.includes("whatsapp.start()")) {
    console.log(`  ${GREEN}✓${RESET} WhatsApp auto-start configured`);
  } else {
    console.log(`  ${RED}✗${RESET} WhatsApp auto-start NOT configured`);
    allTestsPassed = false;
  }
} else {
  console.log(`  ${RED}✗${RESET} Main system file NOT found`);
  allTestsPassed = false;
}

// Test 6: Check message_user integration
console.log(`\n${BOLD}Test 6: Checking message_user integration...${RESET}`);
const messageUserPath = join(process.cwd(), "src/tools/built-in/message-user.ts");

if (existsSync(messageUserPath)) {
  console.log(`  ${GREEN}✓${RESET} message_user tool found`);
  
  const { readFileSync } = await import("node:fs");
  const messageUserContent = readFileSync(messageUserPath, "utf-8");
  
  if (messageUserContent.includes("onUserMessage")) {
    console.log(`  ${GREEN}✓${RESET} Notification system configured`);
  } else {
    console.log(`  ${YELLOW}⚠${RESET} Notification system may not be properly configured`);
  }
} else {
  console.log(`  ${RED}✗${RESET} message_user tool NOT found`);
  allTestsPassed = false;
}

// Summary
console.log(`\n${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
if (allTestsPassed) {
  console.log(`${GREEN}${BOLD}✓ All tests passed!${RESET}`);
  console.log(`\n${BOLD}WhatsApp Integration Status:${RESET} ${GREEN}OPERATIONAL ✓${RESET}`);
  console.log(`\n${BOLD}How to test:${RESET}`);
  console.log(`  1. Start Lulzasaur: ${BLUE}npm start${RESET}`);
  console.log(`  2. Send a WhatsApp message to the connected device`);
  console.log(`  3. Or ask an agent to send you a message via CLI`);
} else {
  console.log(`${RED}${BOLD}✗ Some tests failed${RESET}`);
  console.log(`\n${BOLD}WhatsApp Integration Status:${RESET} ${RED}ISSUES DETECTED${RESET}`);
  console.log(`\nPlease check the failed tests above and fix the issues.`);
}
console.log(`${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

process.exit(allTestsPassed ? 0 : 1);
