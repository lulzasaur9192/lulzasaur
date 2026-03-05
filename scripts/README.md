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

### `db-health-check.ts`
Checks database connection and basic health metrics.

```bash
npx tsx scripts/db-health-check.ts
```

## Dashboard

### `build-dashboard.ts`
Builds the web dashboard frontend.

```bash
npx tsx scripts/build-dashboard.ts
```

## Environment Variables

These scripts use environment variables from `.env`:

```bash
# Database
DATABASE_URL=postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur

# LLM (required for some scripts)
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

### TypeScript errors
Check compilation:
```bash
npm run lint
```
