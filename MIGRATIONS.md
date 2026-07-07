# Drizzle Kit Migrations Guide

This plugin uses **Drizzle Kit** to manage database migrations. Follow this guide to avoid common mistakes.

---

## Rules

### NEVER do this:

1. **Do NOT delete the `drizzle/` folder** to "regenerate" migrations
   - This removes snapshots and Drizzle Kit loses the history
   - It will only generate CREATE TABLE instead of ALTER TABLE

2. **Do NOT modify already-generated SQL files** in `drizzle/*.sql`
   - Migrations have checksums
   - Modifying an applied migration causes a **checksum mismatch error**

3. **Do NOT run `rm -rf drizzle/` before `npm run db:generate`**

### ALWAYS do this:

1. Modify the schema in `src/schema/*.ts`
2. Run `npm run db:generate` without deleting anything
3. Verify the generated SQL in `drizzle/000X_*.sql`
4. Bump the version in `package.json` and `coongro.manifest.json`
5. Publish: `npm run build && npm publish --registry http://localhost:4873`

---

## Workflow

### Case 1: Add a new table

```bash
# 1. Create the schema file in src/schema/new-table.ts
# 2. Export it in src/schema/index.ts
# 3. Generate migration (Drizzle Kit creates 0001_*.sql automatically)
npm run db:generate
# 4. Verify: should see CREATE TABLE "module_ai_copilot_new_tables" (...)
# 5. Bump version and publish
npm run build && npm publish --registry http://localhost:4873
```

### Case 2: Modify an existing column

```bash
# 1. Modify the schema (e.g. add .defaultRandom() to a uuid column)
# 2. Generate migration (Drizzle Kit detects the change)
npm run db:generate
# 3. Verify: should see ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...
# 4. Bump version and publish
npm run build && npm publish --registry http://localhost:4873
```

### Case 3: Add a new column to an existing table

```bash
# 1. Add the column to the schema file
# 2. Generate migration
npm run db:generate
# 3. Verify: should see ALTER TABLE ... ADD COLUMN ...
# 4. Bump version and publish
npm run build && npm publish --registry http://localhost:4873
```

---

## Troubleshooting

### "Migration checksum mismatch" error

**Cause:** A SQL file was modified after being applied to a tenant.

#### Option A: Revert the change (Recommended)

```bash
# Restore the original SQL from git
git checkout drizzle/0000_*.sql

# Make a NEW migration with the change instead
# - Modify the schema
# - Run npm run db:generate
# - Drizzle Kit will create 0001_*.sql
```

#### Option B: Update checksum in DB (Development only)

```sql
-- Find current checksum
SELECT checksum FROM tenant_XXXXXXXX.schema_migrations
WHERE scope = 'module:@coongro/ai-copilot' AND version = '0000';

-- Update it (ONLY in dev tenants)
UPDATE tenant_XXXXXXXX.schema_migrations
SET checksum = '{new-checksum}'
WHERE scope = 'module:@coongro/ai-copilot' AND version = '0000';
```

#### Option C: Uninstall and reinstall (Data loss)

Uninstall the plugin from the tenant and reinstall it. This **deletes all plugin data**.

---

## drizzle/ folder structure

```
drizzle/
├── 0000_initial_migration.sql     # Initial migration (CREATE TABLES)
├── 0001_add_column.sql            # Incremental migration (ALTER TABLE)
└── meta/
    ├── _journal.json               # Ordered list of all migrations
    ├── 0000_snapshot.json          # Schema state after migration 0000
    └── 0001_snapshot.json          # Schema state after migration 0001
```

- `*.sql`: SQL executed against the database
- `_journal.json`: Migration registry with tags
- `*_snapshot.json`: Schema state after each migration (used to detect changes)

## Checklist before publishing

- [ ] Modified the schema in `src/schema/*.ts`
- [ ] Ran `npm run db:generate` WITHOUT deleting drizzle/
- [ ] Verified the generated SQL in `drizzle/000X_*.sql`
- [ ] SQL is correct (ALTER TABLE for changes, CREATE TABLE for new tables)
- [ ] Bumped version in `package.json` and `coongro.manifest.json`
- [ ] Ran `npm run build` without errors
- [ ] Published to Verdaccio
