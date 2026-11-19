# Supabase Database Migrations & Verification

## Migration Order
Apply files in `/supabase/migrations/` sequentially:
1. `0001_init.sql` — 13 core tables and indexes (money in integer INR paise).
2. `0002_rls.sql` — Row Level Security across all 13 tables and column-level grant restriction on `api_keys.key_hash`.
3. `0003_functions.sql` — `handle_new_user()` auth trigger and `service_role`-only atomic credit/payment RPCs.
4. `0004_seed.sql` — Free, Starter, Pro, and Business plans plus INR credit packs.

## Running Migrations & Two-User RLS Verification
```bash
# Apply all migrations against a PostgreSQL / Supabase database
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

# Run automated two-user RLS isolation test
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_two_user_test.sql
```

## Backup & Restore Notes
- Enable Point-in-Time Recovery (PITR) or daily automated backups in Supabase before production launch.
- Never run un-reviewed DDL in production; add numbered migrations under `/supabase/migrations/`.
