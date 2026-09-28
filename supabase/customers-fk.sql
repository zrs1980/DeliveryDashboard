-- ═══════════════════════════════════════════════════════════════════════════
-- Slice 2 — `customer_id uuid` + foreign keys on every customer-referencing table
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor, AFTER supabase/customers.sql.
-- Safe to re-run — every step is guarded, and re-running is in fact the repair
-- procedure (see "Re-running heals drift" below).
--
-- ─── What this does, and what it deliberately does not ─────────────────────
--
-- Adds a NULLABLE `customer_id uuid REFERENCES customers(id)` to each table,
-- backfills it from `key = customer_ns_id`, and installs a trigger that keeps
-- it filled from then on.
--
-- ⚠ THE OLD `customer_ns_id` COLUMN STAYS, AND NOTHING IS REWRITTEN. Every
-- read path in the application still speaks in keys today. This migration is
-- purely additive: if it were reverted by dropping the new column, the app
-- would not notice. Dropping `customer_ns_id` is a later slice, once the reads
-- have moved, and it is not this one.
--
-- ⚠ NULLABLE, DELIBERATELY. Three real cases need it:
--   * `meeting_processing.customer_ns_id` is NULL on all 18 existing rows
--     (it is only written for meetings processed since September 2026)
--   * `pm_projects` can hold a native project with no NetSuite customer at all
--   * a row whose key does not resolve must still be insertable
-- NOT NULL would convert each of those into a failed write on a working
-- feature. The guarantee this buys is narrower but still worth having:
-- `customer_id` is EITHER NULL OR A REAL CUSTOMER. A join on it can be empty;
-- it can never be wrong.
--
-- ⚠ ON DELETE RESTRICT, not CASCADE. supabase/customers.sql says in capitals
-- that nothing is ever deleted from `customers`. RESTRICT is that sentence
-- enforced by the database instead of by convention: an accidental DELETE now
-- fails loudly rather than silently taking 815 contacts with it.

-- ─── The trigger: keep customer_id filled without touching 23 writers ──────
--
-- Every existing write path sets `customer_ns_id` and knows nothing about
-- `customer_id`. The alternative to this trigger is editing 23 call sites and
-- hoping the 24th is never written — a bet this module has already lost four
-- times ("a capable route with no caller" in CLAUDE.md). One function, applied
-- uniformly, cannot be forgotten by the next feature.
--
-- ⚠ An unresolvable key leaves customer_id NULL — it does NOT fail the insert.
-- Refusing the write would mean a customer going inactive in NetSuite could
-- break an unrelated feature at 3am. A NULL is visible to the verify script
-- and harmless to a join; a rejected insert is lost work.
--
-- `merged_into` is followed, matching customerIdByKey() in lib/customers.ts,
-- so history written under a retired `local:<uuid>` key lands on the NetSuite
-- account that took it over rather than on a shell nobody opens.

CREATE OR REPLACE FUNCTION customers_link_from_key()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_ns_id IS NULL THEN
    NEW.customer_id := NULL;
    RETURN NEW;
  END IF;

  -- Nothing to do when the key did not change and we already have a link.
  IF TG_OP = 'UPDATE'
     AND NEW.customer_ns_id IS NOT DISTINCT FROM OLD.customer_ns_id
     AND NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.merged_into, c.id) INTO NEW.customer_id
  FROM customers c WHERE c.key = NEW.customer_ns_id;

  RETURN NEW;
END;
$$;

-- ─── The table list ─────────────────────────────────────────────────────────
--
-- Every table carrying `customer_ns_id text`, September 2026. `cs_contacts` is
-- listed although it is not deployed here (it was renamed to pm_crm_contacts
-- by pm-crm-rename.sql) so a database that still has it is handled too — every
-- step below is guarded on the table actually existing.
--
-- `customers` itself is absent: its key column is `key`, not `customer_ns_id`.

CREATE OR REPLACE FUNCTION customers_linked_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'pm_crm_contacts', 'pm_crm_opportunities', 'pm_crm_tasks', 'pm_crm_activities',
    'cs_contacts', 'cs_commitments', 'cs_consultant_sentiment', 'cs_contracts',
    'cs_customer_profiles', 'cs_health_flags', 'cs_health_snapshots',
    'cs_outreach_drafts', 'cs_release_matches', 'cs_research_runs', 'cs_agent_runs',
    'cs_customer_index',
    'healthchecks',
    'meeting_processing', 'pm_projects',
    'customer_portal_users', 'portal_invitations', 'project_portal_access',
    'task_notes', 'task_approvals'
  ];
$$;

-- ─── Re-running heals drift ─────────────────────────────────────────────────
--
-- The backfill is written as "set it to what it should be" rather than "set it
-- where it is null", so it is both idempotent AND self-repairing: it relinks
-- rows whose customer was merged after they were written, and rows inserted
-- while the trigger was briefly absent. `syncCustomers()` calls it nightly for
-- exactly that reason.

CREATE OR REPLACE FUNCTION customers_relink_all()
RETURNS TABLE(table_name text, linked bigint) LANGUAGE plpgsql AS $$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY customers_linked_tables() LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;

    EXECUTE format($f$
      UPDATE %I AS x
         SET customer_id = COALESCE(c.merged_into, c.id)
        FROM customers c
       WHERE c.key = x.customer_ns_id
         AND x.customer_id IS DISTINCT FROM COALESCE(c.merged_into, c.id)
    $f$, t);
    GET DIAGNOSTICS n = ROW_COUNT;

    table_name := t; linked := n; RETURN NEXT;
  END LOOP;
END;
$$;

-- ─── Apply it ───────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY customers_linked_tables() LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS customer_id uuid', t);

    -- ADD CONSTRAINT has no IF NOT EXISTS, so check the catalog.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t || '_customer_fk'
         AND conrelid = ('public.' || quote_ident(t))::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (customer_id) '
        'REFERENCES customers(id) ON DELETE RESTRICT',
        t, t || '_customer_fk');
    END IF;

    -- Postgres does not index a foreign key automatically, and "everything for
    -- this customer" is the query this whole slice exists to make possible.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (customer_id)',
      t || '_customer_id_idx', t);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_customer_link', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION customers_link_from_key()',
      t || '_customer_link', t);
  END LOOP;
END $$;

SELECT * FROM customers_relink_all();

-- ─── After running ──────────────────────────────────────────────────────────
--
--   npx tsx --env-file=.env.vercel scripts/verify-customers-table.ts
--
-- Its third column is the one that matters now: rows carrying a key but no
-- link. It must be 0 everywhere. If it is not, the key does not exist in
-- `customers` — run the sync first, then this again.
