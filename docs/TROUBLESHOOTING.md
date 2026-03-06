# Lulzasaur Troubleshooting Guide

A practical guide to diagnosing and fixing common issues based on real operational incidents.

## Table of Contents

- [Slack Integration Issues](#slack-integration-issues)
- [Performance & System Load](#performance--system-load)
- [Agent Communication Problems](#agent-communication-problems)
- [Database Connection Issues](#database-connection-issues)

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
1. **Use `get_system_health`** (if the system is running):
   - Identifies stale agents (no heartbeat for 3x their interval)
   - Shows stuck tasks (0% progress for 30+ minutes)
   - Shows unassigned tasks waiting for workers

2. **Database connection pool exhausted:**
   ```bash
   lsof -i :5432 | wc -l  # PostgreSQL connections
   ```

3. **Agent stuck in turn:**
   - Check `agents` table for `status='active'` with old `updated_at`
   - Check `last_heartbeat_at` — if stale, agent may have crashed
   - Look for session lane deadlocks in logs

3. **Context compaction issues:**
   - Compaction triggers at 40% of token budget
   - Keeps recent messages within 25% of budget (token-aware, not fixed count)
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
| `db-health-check.ts` | Check database health |
| `start-db.ts` | Start embedded PostgreSQL |
| `nuke-db.ts` | Reset database completely |

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
   - Active on heartbeat every 30 minutes (business hours), 60 minutes (off-hours)

---

## Prevention Best Practices

1. **Performance:**
   - Limit recursive file operations
   - Add timeouts to shell commands
   - Monitor load average trends

2. **Agents:**
   - Keep context budgets appropriate for task complexity
   - Monitor heartbeat execution times
   - Use bulletin board for coordination

3. **Database:**
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

- [Slack Setup Guide](SLACK_SETUP.md)
- [Scripts Documentation](../scripts/README.md)
- [Main README](../README.md)

---

**Last Updated:** Based on operational incidents through March 2026  
**Maintained by:** writer agent with input from sysadmin, coder, and operational experience
