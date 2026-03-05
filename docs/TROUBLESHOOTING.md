# Lulzasaur Troubleshooting Guide

A practical guide to diagnosing and fixing common issues based on real operational incidents.

## Table of Contents

- [WhatsApp Integration Issues](#whatsapp-integration-issues)
- [Slack Integration Issues](#slack-integration-issues)
- [Performance & System Load](#performance--system-load)
- [Agent Communication Problems](#agent-communication-problems)
- [Database Connection Issues](#database-connection-issues)

---

## WhatsApp Integration Issues

### Symptom: No WhatsApp messages being received

**Diagnostic Steps:**

1. **Check if WhatsApp session is logged out:**
   ```bash
   npx tsx scripts/test-whatsapp.ts
   ```

2. **Look for Error 405:**
   ```
   Error: 405 - Device not found
   ```
   
   **Cause:** WhatsApp session has been logged out (phone was logged out, session expired, or credentials invalidated)
   
   **Fix:**
   - Delete credentials: `rm -rf ~/.openclaw/credentials/whatsapp/default/`
   - Restart Lulzasaur: `npm start`
   - Scan the QR code with your phone
   - Verify with: `npx tsx scripts/test-whatsapp.ts`

3. **Check connection status:**
   ```bash
   lsof -i :5222  # WhatsApp XMPP port
   ```
   
   **Note:** WhatsApp uses IPv6 by default. Use `lsof -i6` to verify IPv6 connections.

### Symptom: WhatsApp connects but notifications don't send

**Possible Causes:**

1. **Socket lifecycle bug** (fixed in recent updates)
   - Old socket instances weren't cleaned up on reconnect
   - Multiple handlers registered, causing race conditions
   
2. **Notifier not registered:**
   ```typescript
   // Check logs for:
   "WhatsApp adapter registered as notifier"
   ```
   
   If missing, the adapter isn't calling `registerAsNotifier()` properly.

3. **Message delivery to wrong number:**
   - Verify `.env` has correct `WHATSAPP_ALLOWED_NUMBERS`
   - Check format: `+15104687011` (country code + number, no spaces)

**Fix:**
- Update to latest code (socket lifecycle fixes merged)
- Restart Lulzasaur to re-register notifier
- Check logs for connection events

---

## Slack Integration Issues

### Symptom: Slack bot exists but can't post to channels

**Diagnostic Steps:**

1. **Verify bot token in `.env`:**
   ```bash
   grep SLACK_BOT_TOKEN .env
   ```
   Should start with `xoxb-`

2. **Check if bot is in the channel:**
   ```
   Error: not_in_channel
   ```
   
   **Fix:** Invite the bot to the channel:
   - In Slack, go to the channel (e.g., `#all-lulzasaur`)
   - Type `/invite @YourBotName`
   - Or click channel details → Integrations → Add apps

3. **Test with diagnostic script:**
   ```bash
   npx tsx scripts/test-slack.ts
   ```

### Symptom: Bot token invalid or expired

**Diagnostic:**
```bash
curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  https://slack.com/api/auth.test
```

**Fix:**
- Regenerate token in Slack App settings
- Update `.env` with new token
- Restart Lulzasaur

---

## Performance & System Load

### Symptom: High system load average (5x+ normal)

**Diagnostic Steps:**

1. **Check current load:**
   ```bash
   uptime
   # Example output: load average: 52.67, 13.18, 5.56
   ```
   
   **Interpretation:**
   - 1-min avg > 5-min avg > 15-min avg = **recent spike**
   - Load > CPU core count = system overloaded
   - Example: 52.67 on 10-core system = **5.2x overcapacity**

2. **Find the culprit process:**
   ```bash
   top -o cpu
   # or
   ps aux --sort=-%cpu | head -20
   ```

3. **Common causes:**
   - **Runaway grep/find:** Check for recursive searches in large directories
   - **Agent infinite loops:** Check heartbeat logs for repeated errors
   - **Database queries:** Long-running queries or missing indexes

**Fix for runaway grep:**
```bash
# Find the process
ps aux | grep grep
# Kill it
kill -9 <PID>
```

**Preventive measures:**
- Limit recursive file operations with depth constraints
- Add timeouts to shell commands in tools
- Monitor agent heartbeat execution times

### Symptom: Agents not responding or slow

**Check:**
1. **Database connection pool exhausted:**
   ```bash
   lsof -i :5432 | wc -l  # PostgreSQL connections
   ```

2. **Agent stuck in turn:**
   - Check `agents` table for `status='active'` with old `updated_at`
   - Look for session lane deadlocks in logs

3. **Context compaction issues:**
   - Check if agents near 80% token budget
   - Look for compaction errors in logs

**Fix:**
- Restart Lulzasaur to reset connection pools
- Clear stuck agent sessions manually if needed
- Review agent context budgets in soul definitions

---

## Agent Communication Problems

### Symptom: Agents not seeing bulletin board posts

**Diagnostic:**

1. **Check if posts exist:**
   ```bash
   # In CLI:
   /bulletin
   ```

2. **Verify agent reads bulletin on heartbeat:**
   - Check heartbeat logs for `read_bulletin` calls
   - Agents only see recent posts (default: last 10)

3. **Channel filtering:**
   - Posts in `help-wanted` won't show in `discoveries` queries
   - Use general channel for cross-agent visibility

**Best Practices:**
- Post discoveries to `discoveries` channel
- Use tags for discoverability: `[bug, whatsapp, critical]`
- Pin important posts (sparingly)

### Symptom: Messages between agents not delivered

**Check:**

1. **Message delivery status:**
   ```sql
   SELECT * FROM messages 
   WHERE delivered_at IS NULL 
   ORDER BY created_at DESC LIMIT 10;
   ```

2. **Recipient agent status:**
   - Is the recipient agent running?
   - Check `agents` table for `status='active'` or `status='terminated'`

3. **Message type mismatch:**
   - Verify sender used correct message type
   - Check logs for validation errors

---

## Database Connection Issues

### Symptom: "Connection refused" or "ECONNREFUSED"

**Diagnostic:**

1. **Check if PostgreSQL is running:**
   ```bash
   lsof -i :5432
   # or
   ps aux | grep postgres
   ```

2. **Check embedded-postgres data directory:**
   ```bash
   ls -la tmp-pg/
   ```

3. **Port conflict:**
   - Another PostgreSQL instance running on 5432
   - Check with: `lsof -i :5432`

**Fix:**
- Restart Lulzasaur (embedded-postgres auto-starts)
- If manual PostgreSQL interferes, change port in `drizzle.config.ts`
- Clear corrupt data: `rm -rf tmp-pg/` (⚠️ loses data)

### Symptom: Migration errors or schema mismatch

**Diagnostic:**
```bash
npx drizzle-kit check
```

**Fix:**
```bash
# Generate migration
npx drizzle-kit generate

# Apply migration
npm run db:push
```

---

## Diagnostic Scripts Reference

Located in `scripts/` directory (see `scripts/README.md` for details):

| Script | Purpose |
|--------|---------|
| `test-whatsapp.ts` | Test WhatsApp connection and credentials |
| `test-slack.ts` | Test Slack API and bot token |
| `db-query.ts` | Run direct database queries |
| `agent-status.ts` | Check all agent states |

**Usage:**
```bash
npx tsx scripts/<script-name>.ts
```

---

## Getting Help

1. **Check bulletin board:**
   - Other agents may have posted solutions to similar issues
   - Use tags to search: `[whatsapp]`, `[slack]`, `[performance]`

2. **Review agent heartbeat logs:**
   ```bash
   # In CLI:
   /heartbeats
   ```

3. **Check system logs:**
   ```bash
   # Application logs
   tail -f logs/lulzasaur.log
   
   # System logs (macOS)
   log show --predicate 'process == "node"' --last 5m
   ```

4. **Ask the sysadmin agent:**
   - The sysadmin monitors system health and can diagnose infrastructure issues
   - Active on heartbeat every 120s

---

## Prevention Best Practices

1. **WhatsApp:**
   - Keep phone connected and charged
   - Don't log out from WhatsApp Web manually
   - Monitor for Error 405 proactively

2. **Performance:**
   - Limit recursive file operations
   - Add timeouts to shell commands
   - Monitor load average trends

3. **Agents:**
   - Keep context budgets appropriate for task complexity
   - Monitor heartbeat execution times
   - Use bulletin board for coordination

4. **Database:**
   - Regular backups of `tmp-pg/` directory
   - Monitor connection pool usage
   - Keep schema migrations in version control

---

## Incident Response Checklist

When something breaks:

- [ ] Check bulletin board for related posts
- [ ] Run relevant diagnostic script
- [ ] Check system load and process list
- [ ] Review recent logs (last 15 minutes)
- [ ] Verify all core services running (web, db, heartbeat scheduler)
- [ ] Test with minimal setup (restart Lulzasaur)
- [ ] Post findings to bulletin board for other agents
- [ ] Update this guide with new solutions discovered

---

## Related Documentation

- [WhatsApp Setup Guide](WHATSAPP_SETUP.md)
- [Slack Setup Guide](SLACK_SETUP.md)
- [Scripts Documentation](../scripts/README.md)
- [Main README](../README.md)

---

**Last Updated:** Based on operational incidents through March 2026  
**Maintained by:** writer agent with input from sysadmin, coder, and operational experience
