-- ═══════════════════════════════════════════════════════════════════════════
-- `customers` — the record everything finally hangs off
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor. Safe to re-run: every statement is
-- IF NOT EXISTS / OR REPLACE.
--
-- ─── Why this exists ───────────────────────────────────────────────────────
--
-- 38 tables in this schema reference a customer, all of them by
-- `customer_ns_id text`, none of them with a foreign key. That was deliberate
-- and it was right: the customer master is NetSuite, and a foreign key to a
-- table we do not own is a lie waiting to be told.
--
-- The cost turned up later. There is no way to ask "everything about this
-- customer" in one query, no referential integrity anywhere, and
-- `cs_customer_index` — the closest thing to a customer record — says in
-- capitals at the top of its own file that it is a CACHE and must be safe to
-- drop and rebuild. You cannot hang foreign keys off something you are allowed
-- to truncate.
--
-- So: a thin, stable identity table. It holds who a customer IS and nothing
-- about how they are DOING. Health scores, hours, contracts and flags stay in
-- cs_customer_index, which stays a cache and stays droppable.
--
-- ⚠ THIS TABLE IS NOT A CACHE AND MUST NOT BE TRUNCATED. Rows are referenced
-- by foreign keys from ~20 tables. A customer that leaves NetSuite is marked
-- `is_active = false`, never deleted — deleting would either cascade real CRM
-- history away or fail outright. That is the opposite of cs_customer_index,
-- which prunes rows that vanish, and the difference is the whole point.
--
-- ─── The key problem, and the answer ───────────────────────────────────────
--
-- `customer_ns_id` is NOT type-homogeneous. It holds either:
--
--   * a NetSuite customer internal id as text  ("16650")
--   * a synthetic local id                     ("local:<uuid>")
--
-- The second is for prospects NetSuite has never heard of — see
-- supabase/pm-crm-accounts.sql and lib/crm-accounts.ts. A naive foreign key to
-- a NetSuite-keyed table would orphan every one of them, which is roughly "the
-- first five minutes of every new opportunity".
--
-- So `key` holds EXACTLY what the existing columns already hold, verbatim, in
-- all its heterogeneity — and `ns_id` / `local_id` decompose it. Nothing is
-- rewritten anywhere; every existing `customer_ns_id` value backfills by
-- `key = customer_ns_id` and keeps working unchanged. The CHECK below makes
-- `key` derivable rather than independently editable, so the two can never
-- disagree.

CREATE TABLE IF NOT EXISTS customers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Verbatim what every `customer_ns_id text` column in this schema holds.
  -- This is the backfill join and the migration's entire safety argument.
  key       text NOT NULL UNIQUE,

  -- Exactly one of these is set. Kept as text, not integer: `key` is text,
  -- every existing column is text, and NetSuite ids are only incidentally
  -- numeric.
  ns_id     text UNIQUE,
  local_id  uuid UNIQUE REFERENCES pm_crm_accounts(id) ON DELETE CASCADE,

  -- ─── Identity, and only identity ────────────────────────────────────────
  -- Everything here is cheap, slow-moving and safe for anyone with a login to
  -- see. Nothing judgmental lives in this table: no score, no band, no flag
  -- count. That is not tidiness — a risk judgment reaching the delivery team
  -- is self-fulfilling, and keeping it out of the table every module joins to
  -- means it cannot leak by accident.
  name           text NOT NULL,
  entityid       text,
  email          text,
  phone          text,
  website        text,
  industry       text,
  subsidiary_id  integer,           -- 1 = Parent (CEBA/Loop Services), 2 = Loop ERP
  stage          text,              -- CUSTOMER | PROSPECT | LEAD

  -- ─── Provenance ─────────────────────────────────────────────────────────
  source        text NOT NULL CHECK (source IN ('netsuite','local')),

  -- Soft retirement. A customer going inactive in NetSuite, or a local
  -- prospect being linked, sets this. See the warning above: nothing deletes.
  is_active       boolean NOT NULL DEFAULT true,
  deactivated_at  timestamptz,

  -- When a local prospect becomes real in NetSuite, its row is retired and
  -- points at the NetSuite row that took over. Recorded rather than deleted so
  -- CRM history written under the `local:` key can still be traced to the
  -- account it belongs to now.
  merged_into   uuid REFERENCES customers(id) ON DELETE SET NULL,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at  timestamptz NOT NULL DEFAULT now(),

  -- Exactly one origin.
  CONSTRAINT customers_one_origin
    CHECK ((ns_id IS NOT NULL) <> (local_id IS NOT NULL)),

  -- `key` is derived, never hand-edited. This is what lets the FK backfill on
  -- `key = customer_ns_id` be provably correct rather than merely plausible.
  CONSTRAINT customers_key_matches_origin
    CHECK (key = COALESCE(ns_id, 'local:' || local_id::text))
);

CREATE INDEX IF NOT EXISTS customers_name_idx   ON customers (lower(name));
CREATE INDEX IF NOT EXISTS customers_active_idx ON customers (is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS customers_stage_idx  ON customers (stage);

-- No updated_at trigger here, deliberately. `cs_set_updated_at()` writes an
-- `updated_at` column this table does not have, and adding one would give two
-- answers to "when did this last change": the trigger's, and `refreshed_at`,
-- which the sync sets on every row it touches whether anything differed or not.
-- One timestamp, written by the thing that does the writing.

-- ─── Access control ─────────────────────────────────────────────────────────
--
-- Reached only through the service-role client, so RLS would be decorative —
-- the same reasoning as every cs_ table. Unlike those, this one is NOT
-- cs_layer-gated: it is identity, every module needs it, and it deliberately
-- holds nothing a consultant may not see. Keep it that way. The moment a
-- health field lands here, every route that joins to customers has to start
-- thinking about who is asking.

-- ─── Populating it ──────────────────────────────────────────────────────────
--
-- syncCustomers() in lib/customers.ts, run at the start of the nightly job and
-- reachable on demand. Two sources, matching the two shapes of `key`:
--
--   netsuite → EVERY customer record, active or not (445; 265 inactive)
--   local    → pm_crm_accounts — where linked_ns_id IS NULL
--
-- ⚠ THE UNIVERSE HERE IS WIDER THAN `fetchCsCustomers()`, WHICH FILTERS
-- `isinactive = 'F'` (180 rows) AND IS RIGHT TO. Measured September 2026: the
-- CRM holds 295 deals and 815 contacts imported before the NetSuite sync was
-- retired, and 67 of the customers they reference have since been deactivated.
-- Against the active-only list, 23 contact keys and 59 opportunity keys
-- resolved to nothing — so the foreign key below would have rejected real,
-- wanted history. Being in this table is not a claim that a customer is live;
-- it is a claim that something references them. `is_active` says which.
--
-- There is no seed SQL here on purpose. A seed and a builder that both write
-- the same table drift, and the builder is the one that has to keep running.
