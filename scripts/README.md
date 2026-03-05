# Lulzasaur Scripts

Utility scripts for managing and troubleshooting the Lulzasaur agent system.

## Database Scripts

### `start-db.ts`
Starts the embedded PostgreSQL database.

```bash
npm run db:start
# or
npx tsx scripts/start-db.ts
```

### `nuke-db.ts`
⚠️ **DESTRUCTIVE** - Completely wipes the database and recreates schema.

```bash
npx tsx scripts/nuke-db.ts
```

## WhatsApp Diagnostic Scripts

### `test-whatsapp.ts`
Tests WhatsApp connection status and attempts to send a test message.

**What it checks:**
- ✅ Credentials exist at `~/.openclaw/credentials/whatsapp/default/creds.json`
- ✅ Can initialize WhatsApp client
- ✅ Connection status (connected/disconnected/logged out)
- ✅ Connected phone number and JID
- ✅ Ability to send test messages

**Usage:**
```bash
npx tsx scripts/test-whatsapp.ts
```

**Exit codes:**
- `0` - WhatsApp connection successful
- `1` - Connection failed or credentials missing

### `restart-whatsapp.ts`
Comprehensive WhatsApp connection manager with detailed diagnostics.

**Features:**
- Shows QR code if re-authentication needed
- Detects and explains error codes:
  - `405` - Session conflict (another session active - usually normal)
  - `logged out` - Needs QR code re-scan
- Sends test message on successful connection
- Provides specific troubleshooting steps for each error

**Usage:**
```bash
npx tsx scripts/restart-whatsapp.ts
```

**Common scenarios:**

1. **Status 405 (Connection Conflict)**
   - This is NORMAL when the main Lulzasaur app is running
   - The main app holds the WhatsApp connection
   - Only one process can connect at a time

2. **Logged Out**
   - Delete credentials: `rm -rf ~/.openclaw/credentials/whatsapp/default`
   - Restart main Lulzasaur app
   - Scan new QR code with your phone

3. **Messages not arriving**
   - Check `WHATSAPP_ALLOWED_NUMBERS` in `.env`
   - Verify phone number format: `+15104687011`
   - Check main app logs for errors
   - Logout other WhatsApp Web sessions on your phone

### `send-test-notification.ts`
Sends a test notification through the message_user tool to verify end-to-end delivery.

**What it does:**
- Creates or uses test agent
- Calls message_user tool with test message
- Shows tool execution results
- Verifies notification delivery to all interfaces (CLI, Web, WhatsApp)

**Usage:**
```bash
npx tsx scripts/send-test-notification.ts
```

Check your WhatsApp, web dashboard, and CLI to verify the message was delivered.

## Environment Variables

These scripts use environment variables from `.env`:

```bash
# WhatsApp Configuration
WHATSAPP_ALLOWED_NUMBERS=+15104687011  # Comma-separated phone numbers

# Database
DATABASE_URL=postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur

# LLM (required for send-test-notification.ts)
ANTHROPIC_API_KEY=sk-ant-...
DEFAULT_LLM_PROVIDER=anthropic
DEFAULT_LLM_MODEL=claude-sonnet-4-5
```

## Troubleshooting

### "Cannot find module"
Make sure dependencies are installed:
```bash
npm install
```

### "Database connection failed"
Start the database first:
```bash
npm run db:start
```

### "WhatsApp credentials not found"
Run the main Lulzasaur app to generate QR code:
```bash
npm start
```
Then scan the QR code with WhatsApp on your phone.

### TypeScript errors
Check compilation:
```bash
npm run lint
```
