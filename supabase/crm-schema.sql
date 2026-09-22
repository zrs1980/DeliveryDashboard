-- ─── CRM — contacts, pipeline, tasks, activity ─────────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to re-run: every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--
-- ─── What lives where ──────────────────────────────────────────────────────
--
-- CUSTOMERS STAY IN NETSUITE. They are read through cs_customer_index and are
-- never written here. Everything below keys to them by `customer_ns_id text`,
-- the same no-foreign-key convention the other twelve tables use.
--
-- CONTACTS AND OPPORTUNITIES ARE MIRRORED, THEN OWNED HERE. They are seeded
-- from NetSuite and can afterwards be edited and created in this app. The sync
-- is ONE WAY — NetSuite to here. Nothing in this app writes back to NetSuite,
-- because the integration has no write path to these records and inventing one
-- silently would put the ERP behind a dashboard.
--
-- TASKS AND ACTIVITY ARE NATIVE. There is nothing to seed tasks from: `task`,
-- `phonecall` and `calendarevent` are not exposed to this integration at all,
-- and the `activity` view is empty. Email history is the exception — see
-- crm_activities below.

-- ─── Contacts ──────────────────────────────────────────────────────────────
--
-- Extends the EXISTING cs_contacts rather than adding a second contacts table.
-- That table already carries the role and liveness model the CS layer needs
-- (economic_buyer / champion / admin / end_user / technical, is_active,
-- last_seen_at, departed_detected_at) and was empty. A parallel crm_contacts
-- would be exactly the duplication this scaffolding exists to remove.
--
-- ⚠ NETSUITE'S OWN CONTACT ROLE IS UNUSABLE, so cs_contacts.role stays
-- app-owned. `contact.contactrole` is set on 26 of 1,014 contacts, and its
-- values are built-in negative ids (-10, -20, -30, -40) whose labels cannot be
-- resolved through SuiteQL or the metadata catalog at all. Seeding from it
-- would import 26 unlabelled numbers and leave 988 blank.

ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS ns_contact_id   text;
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS first_name      text;
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS last_name       text;
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS phone           text;
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS mobile          text;
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS is_primary      boolean DEFAULT false;
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS owner_email     text;
-- 'netsuite' for a mirrored row, 'manual' for one created here. A sync must
-- never overwrite a manual row, and must never delete one.
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS source          text DEFAULT 'manual';
ALTER TABLE cs_contacts ADD COLUMN IF NOT EXISTS synced_at       timestamptz;

-- The sync key. Partial, because manually created contacts have no NetSuite id
-- and several of them may legitimately share a null.
CREATE UNIQUE INDEX IF NOT EXISTS cs_contacts_ns_uniq
  ON cs_contacts (ns_contact_id) WHERE ns_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cs_contacts_name_idx ON cs_contacts (lower(name));

-- ─── Pipeline stages ───────────────────────────────────────────────────────
--
-- Seeded from NetSuite's `entitystatus` table, which is queryable and carries
-- the probability for each stage — 39 rows including stages no current
-- opportunity sits in ("60 - Proposal Development" 60%, "80 - SOW Creation"
-- 70%, "90 - SOW Sent"). Stored rather than read live so the pipeline board has
-- a stable column order, and so a stage can be reordered or hidden here without
-- touching NetSuite.

CREATE TABLE IF NOT EXISTS crm_stages (
  id            text PRIMARY KEY,          -- NetSuite entitystatus key, as text
  name          text NOT NULL,
  entity_type   text,                      -- LEAD | PROSPECT | CUSTOMER | JOB
  probability   numeric,
  sort_order    integer NOT NULL DEFAULT 0,
  is_won        boolean DEFAULT false,
  is_lost       boolean DEFAULT false,
  is_open       boolean DEFAULT true,
  hidden        boolean DEFAULT false,     -- keep off the board without deleting
  created_at    timestamptz DEFAULT now()
);

-- ─── Opportunities ─────────────────────────────────────────────────────────
--
-- 295 exist in NetSuite; 23 are open. All 295 join cleanly to a customer — no
-- job trap here, unlike supportcase.company.
--
-- ⚠ `projectedtotal` is the pipeline number, NOT `total`. Across all 295,
-- projectedtotal sums to $7.79M while total sums to $927k, because total is
-- only filled once a deal transacts. Seeding from `total` would report a
-- pipeline an order of magnitude too small.

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null for an opportunity created in this app. Unique when present.
  ns_opportunity_id text,
  ns_tranid         text,
  customer_ns_id    text NOT NULL,
  customer_name     text,

  title             text NOT NULL,
  description       text,
  stage_id          text REFERENCES crm_stages(id),
  stage_name        text,
  status            text,                  -- A in progress | C won | D lost
  opportunity_type  text,                  -- custbody5: Services: Project | NetSuite Licenses | MSA

  projected_total   numeric,
  weighted_total    numeric,
  probability       numeric,

  expected_close    date,
  close_date        date,
  tran_date         date,
  days_open         integer,

  owner_ns_id       integer,               -- salesrep
  owner_name        text,
  primary_contact_id uuid REFERENCES cs_contacts(id) ON DELETE SET NULL,
  lead_source       text,

  source            text DEFAULT 'manual', -- netsuite | manual
  synced_at         timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_opps_ns_uniq
  ON crm_opportunities (ns_opportunity_id) WHERE ns_opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_opps_customer ON crm_opportunities (customer_ns_id);
CREATE INDEX IF NOT EXISTS crm_opps_board    ON crm_opportunities (stage_id, expected_close);
CREATE INDEX IF NOT EXISTS crm_opps_open     ON crm_opportunities (status) WHERE status = 'A';

-- Line detail. 108 lines across 56 opportunities — most have none.
--
-- ⚠ ON OPPORTUNITY LINES NETSUITE STORES quantity AND netamount NEGATIVE,
-- while rate and price are positive. The sync flips the sign; if a line ever
-- shows a negative amount here, the flip has been applied twice.
CREATE TABLE IF NOT EXISTS crm_opportunity_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  ns_unique_key   text,
  line_number     integer,
  item_name       text,
  item_type       text,
  description     text,
  quantity        numeric,
  rate            numeric,
  amount          numeric,
  created_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_opp_lines_ns_uniq
  ON crm_opportunity_lines (ns_unique_key) WHERE ns_unique_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_opp_lines_opp ON crm_opportunity_lines (opportunity_id);

-- ─── Tasks ─────────────────────────────────────────────────────────────────
--
-- Entirely native. NetSuite exposes no task, call or event data to this
-- integration, so there is nothing to seed and nothing to sync.
--
-- A task may hang off a customer, a contact, an opportunity, or any
-- combination — "call Jane about the renewal" is all three.

CREATE TABLE IF NOT EXISTS crm_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id  text,
  contact_id      uuid REFERENCES cs_contacts(id) ON DELETE SET NULL,
  opportunity_id  uuid REFERENCES crm_opportunities(id) ON DELETE CASCADE,

  title           text NOT NULL,
  notes           text,
  task_type       text DEFAULT 'todo'
                    CHECK (task_type IN ('todo','call','email','meeting','follow_up')),
  priority        text DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','done','cancelled')),

  due_date        date,
  completed_at    timestamptz,
  assigned_to     text,                    -- email; the roster is NetSuite's
  created_by      text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_tasks_open ON crm_tasks (status, due_date) WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS crm_tasks_customer ON crm_tasks (customer_ns_id);
CREATE INDEX IF NOT EXISTS crm_tasks_assignee ON crm_tasks (lower(assigned_to), status);

-- ─── Activity timeline ─────────────────────────────────────────────────────
--
-- What happened with this account, in one stream: emails, notes, calls,
-- meetings, stage changes.
--
-- Email history is SEEDED FROM NETSUITE, not from Gmail. The `message` table
-- holds 4,548 emails of which 4,310 are linked to a customer, and reading it
-- costs no new OAuth scope. Gmail can already SEND as the signed-in user; it
-- cannot READ without adding gmail.readonly, which would invalidate every
-- session and force everyone to sign in again. Outbound mail sent from this app
-- is logged here at send time, so the timeline stays current without that.
--
-- ⚠ NetSuite's email history hangs off the CUSTOMER, not the contact — 4,310
-- customer-linked against 9 contact-linked. Do not expect a per-contact history
-- from the seed.

CREATE TABLE IF NOT EXISTS crm_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id  text,
  contact_id      uuid REFERENCES cs_contacts(id) ON DELETE SET NULL,
  opportunity_id  uuid REFERENCES crm_opportunities(id) ON DELETE CASCADE,

  kind            text NOT NULL
                    CHECK (kind IN ('email','note','call','meeting','stage_change','task_done')),
  direction       text CHECK (direction IN ('inbound','outbound','internal')),
  subject         text,
  body            text,

  occurred_at     timestamptz NOT NULL,
  actor_email     text,
  actor_name      text,

  -- 'netsuite' for the seeded message history, 'app' for anything this
  -- application recorded itself.
  source          text NOT NULL DEFAULT 'app',
  ns_message_id   text,
  created_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_ns_uniq
  ON crm_activities (ns_message_id) WHERE ns_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_activities_customer ON crm_activities (customer_ns_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_activities_contact  ON crm_activities (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_activities_opp      ON crm_activities (opportunity_id, occurred_at DESC);

-- ─── updated_at triggers ───────────────────────────────────────────────────
-- cs_set_updated_at() already exists, created by cs-agent-schema.sql.

DROP TRIGGER IF EXISTS crm_opps_touch ON crm_opportunities;
CREATE TRIGGER crm_opps_touch BEFORE UPDATE ON crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

DROP TRIGGER IF EXISTS crm_tasks_touch ON crm_tasks;
CREATE TRIGGER crm_tasks_touch BEFORE UPDATE ON crm_tasks
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

-- ─── Access control ────────────────────────────────────────────────────────
--
-- Service-role only, no RLS, same as every other internal table here.
--
-- ⚠ CRM IS NOT BEHIND cs_layer. Contacts, pipeline and tasks are ordinary
-- commercial work that account managers and PMs do, not the risk data the
-- cs_layer boundary exists to contain. Health scores, flags and outreach drafts
-- stay behind it; nothing in these tables carries them, and no CRM route may
-- join to cs_health_flags or cs_health_snapshots to add them.
