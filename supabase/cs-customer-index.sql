-- ─── Customer index — the scaffolding table ────────────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE.
--
-- ⚠ THIS TABLE IS A CACHE. IT IS NEVER AUTHORITATIVE.
--
-- Every column is derived from NetSuite or from another table in this schema.
-- It exists so the account-manager worklist is one SELECT instead of a fan-out
-- across SuiteQL, Supabase and ClickUp on every page load. Dropping it and
-- rebuilding from scratch must always be safe, and nothing may be written here
-- that cannot be regenerated — if a field needs to survive a rebuild, it
-- belongs in a table of its own.
--
-- Rebuilt by buildCustomerIndex() in lib/cs-customer-index.ts, which runs at
-- the end of the nightly scoring job.
--
-- ─── The universe ──────────────────────────────────────────────────────────
--
-- One row per ACTIVE NetSuite customer — `isinactive = 'F'`, no status filter,
-- 180 rows as of Sep 2026. This deliberately includes 90 prospects and 68
-- closed-lost alongside real customers, because the previous filter
-- (`entitystatus = 13`, 55 rows) silently hid 30 lost customers, one
-- NON-RENEWING customer, one Loop ERP account pending, and 26 active customers
-- holding real project records.
--
-- `stage` is what separates them: CUSTOMER (87) is scored for health, PROSPECT
-- (90) and LEAD (3) are visible but never judged. Being in the index and being
-- scored are different things.
--
-- ─── Loop vs CEBA ──────────────────────────────────────────────────────────
--
-- `subsidiary_id` 1 = Parent Company (CEBA / Loop Services), 2 = Loop ERP.
-- Populated on 100% of customer records in NetSuite and previously read by
-- nothing in this app. Two customers (Certified Waste Solutions, The Yaffe
-- Companies) sit in BOTH — `in_both_subsidiaries` flags them so neither book
-- excludes them.

CREATE TABLE IF NOT EXISTS cs_customer_index (
  customer_ns_id        text PRIMARY KEY,
  entityid              text,
  name                  text NOT NULL,
  email                 text,
  phone                 text,

  -- ─── Segmentation ───────────────────────────────────────────────────────
  subsidiary_id         integer,
  subsidiary_name       text,
  in_both_subsidiaries  boolean DEFAULT false,
  stage                 text,              -- CUSTOMER | PROSPECT | LEAD
  entitystatus_id       integer,
  entitystatus_label    text,
  industry              text,
  category              text,

  -- ─── Ownership ──────────────────────────────────────────────────────────
  salesrep_ns_id        integer,
  salesrep_name         text,
  consultant_ns_id      integer,
  consultant_name       text,

  -- ─── Drive ──────────────────────────────────────────────────────────────
  -- custentity_customer_folder, and the id parsed out of it. Populated on 8 of
  -- 180; the rest stay null until the field is backfilled in NetSuite rather
  -- than being guessed at by folder name.
  drive_folder_url      text,
  drive_folder_id       text,

  -- ─── Delivery rollup ────────────────────────────────────────────────────
  -- Hours are ACTUAL time only (timetype='A'), rolled up
  -- timebill.customer -> job.id -> job.customer, with LEAVE_PROJECT_IDS
  -- excluded. Anything else counts forward-dated allocation and PTO as
  -- customer engagement.
  project_count         integer DEFAULT 0,
  active_project_count  integer DEFAULT 0,
  hours_90d             numeric DEFAULT 0,
  last_activity_date    date,
  days_since_activity   integer,

  -- ─── Support rollup ─────────────────────────────────────────────────────
  -- supportcase.company is a customer id OR a job id — 596 of 1080 are jobs —
  -- so these counts roll up through both.
  cases_90d             integer DEFAULT 0,
  open_cases            integer DEFAULT 0,

  -- ─── Commercial ─────────────────────────────────────────────────────────
  -- From CUSTOMRECORD_CONTRACTS, governing contract only (a renewed term must
  -- not be reported as current). notice_date is end_date minus the locally
  -- recorded notice period; null notice period means it equals end_date.
  contract_count        integer DEFAULT 0,
  contract_status       text,
  contract_end_date     date,
  notice_date           date,
  annual_value          numeric,
  last_sales_activity   date,              -- custentity_date_lsa

  -- ─── CS state ───────────────────────────────────────────────────────────
  has_profile           boolean DEFAULT false,
  profile_verified      boolean DEFAULT false,
  health_score          integer,
  health_band           text,
  open_flag_count       integer DEFAULT 0,

  -- ─── Health checks ──────────────────────────────────────────────────────
  last_healthcheck_at      timestamptz,
  current_quarter_status   text,           -- completed | scheduled | overdue | unscheduled

  refreshed_at          timestamptz NOT NULL DEFAULT now()
);

-- The worklist queries: by book, by renewal proximity, by who has been ignored.
CREATE INDEX IF NOT EXISTS cs_cust_idx_subsidiary ON cs_customer_index (subsidiary_id);
CREATE INDEX IF NOT EXISTS cs_cust_idx_stage      ON cs_customer_index (stage);
CREATE INDEX IF NOT EXISTS cs_cust_idx_notice     ON cs_customer_index (notice_date)
  WHERE notice_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS cs_cust_idx_quiet      ON cs_customer_index (days_since_activity);
CREATE INDEX IF NOT EXISTS cs_cust_idx_name       ON cs_customer_index (lower(name));

-- ─── Access control ─────────────────────────────────────────────────────────
--
-- Reached only through the service-role client, so RLS is deliberately not
-- enabled — it would be decorative. The boundary is requireCsLayer() in
-- lib/cs-permissions.ts, as with every other cs_ table.
--
-- One exception worth noting: /api/customers reads this table to serve the
-- Customers tab, which is session-gated but NOT cs_layer-gated. That route
-- returns identity fields only (id, entityid, name, email, phone) and must
-- never be widened to include health_score, health_band or open_flag_count —
-- risk data reaching the delivery team is self-fulfilling.

-- ─── Customer keys on two tables that never had one ────────────────────────
--
-- Both are additive and nullable, so existing rows and existing writes keep
-- working untouched.
--
-- meeting_processing recorded only project_ns_id, so a meeting could not be
-- attributed to an account — which made "what have we discussed with this
-- customer" unanswerable even though the transcripts were filed.
ALTER TABLE meeting_processing
  ADD COLUMN IF NOT EXISTS customer_ns_id text;

CREATE INDEX IF NOT EXISTS meeting_processing_customer_idx
  ON meeting_processing (customer_ns_id);

-- pm_projects identifies its client by free text (`client_name`), with no id
-- behind it, so a native project could never be joined to the NetSuite account
-- it belongs to. The text column stays — it is the only identifier for projects
-- with no NetSuite job at all.
ALTER TABLE pm_projects
  ADD COLUMN IF NOT EXISTS customer_ns_id text;

CREATE INDEX IF NOT EXISTS pm_projects_customer_idx
  ON pm_projects (customer_ns_id);
