-- ─── CRM tables move to the pm_crm_ prefix, and stop syncing ───────────────
-- Run this in the Supabase SQL Editor AFTER crm-schema.sql.
-- Safe to re-run: every rename is guarded, every drop is IF EXISTS.
--
-- Two changes, both requested:
--
-- 1. PREFIX. The new tables take `pm_crm_`, not `pm_`. A plain `pm_` prefix
--    collides head-on: `pm_tasks` ALREADY EXISTS and holds project tasks
--    (supabase/pm-schema.sql), alongside pm_phases, pm_projects,
--    pm_time_entries and pm_status_reports. Naming a CRM task table `pm_tasks`
--    would have been the one collision that actually mattered.
--
-- 2. CONTACTS, TASKS AND ACTIVITIES ARE APP-ONLY. They no longer sync from
--    NetSuite in either direction. Opportunities still do — those were asked
--    for specifically, and the pipeline is only worth having if it reflects the
--    deals NetSuite knows about.
--
-- Nothing is deleted. Contacts already imported stay, and are now simply
-- app-owned rows like any other; `ns_contact_id` is kept as provenance —
-- where this row originally came from — and is no longer a sync key.

-- ─── Rename ────────────────────────────────────────────────────────────────
-- Postgres carries indexes, constraints and foreign keys through a rename;
-- only their NAMES stay as they were, which is cosmetic.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'cs_contacts')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_name = 'pm_crm_contacts') THEN
    ALTER TABLE cs_contacts RENAME TO pm_crm_contacts;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_stages')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_crm_stages') THEN
    ALTER TABLE crm_stages RENAME TO pm_crm_stages;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_opportunities')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_crm_opportunities') THEN
    ALTER TABLE crm_opportunities RENAME TO pm_crm_opportunities;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_opportunity_lines')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_crm_opportunity_lines') THEN
    ALTER TABLE crm_opportunity_lines RENAME TO pm_crm_opportunity_lines;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_tasks')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_crm_tasks') THEN
    ALTER TABLE crm_tasks RENAME TO pm_crm_tasks;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_activities')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_crm_activities') THEN
    ALTER TABLE crm_activities RENAME TO pm_crm_activities;
  END IF;
END $$;

-- If crm-schema.sql was never run, create everything fresh under the new names.
CREATE TABLE IF NOT EXISTS pm_crm_contacts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id       text NOT NULL,
  name                 text NOT NULL,
  first_name           text,
  last_name            text,
  email                text,
  job_title            text,
  phone                text,
  mobile               text,
  role                 text NOT NULL DEFAULT 'unknown'
                         CHECK (role IN ('economic_buyer','champion','admin','end_user','technical','unknown')),
  is_primary           boolean DEFAULT false,
  is_active            boolean DEFAULT true,
  first_seen_at        timestamptz,
  last_seen_at         timestamptz,
  departed_detected_at timestamptz,
  notes                text,
  owner_email          text,
  -- Provenance, not a sync key. A row imported before contacts became app-only
  -- keeps a record of where it came from; nothing reads it to match or
  -- overwrite, and no sync writes this table any more.
  ns_contact_id        text,
  source               text DEFAULT 'manual',
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- The remaining five, so this file stands on its own against a clean database
-- rather than only working as a rename of what crm-schema.sql created. Without
-- these the index statements below fail on a database that has never seen the
-- old names.

CREATE TABLE IF NOT EXISTS pm_crm_stages (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  entity_type   text,
  probability   numeric,
  sort_order    integer NOT NULL DEFAULT 0,
  is_won        boolean DEFAULT false,
  is_lost       boolean DEFAULT false,
  is_open       boolean DEFAULT true,
  hidden        boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm_crm_opportunities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ns_opportunity_id  text,
  ns_tranid          text,
  customer_ns_id     text NOT NULL,
  customer_name      text,
  title              text NOT NULL,
  description        text,
  stage_id           text REFERENCES pm_crm_stages(id),
  stage_name         text,
  status             text,
  opportunity_type   text,
  projected_total    numeric,
  weighted_total     numeric,
  probability        numeric,
  expected_close     date,
  close_date         date,
  tran_date          date,
  days_open          integer,
  owner_ns_id        integer,
  owner_name         text,
  primary_contact_id uuid REFERENCES pm_crm_contacts(id) ON DELETE SET NULL,
  lead_source        text,
  source             text DEFAULT 'manual',
  synced_at          timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
-- The imported deals keep a uniqueness guard on their NetSuite id so a re-run
-- of the original import could never double them. Nothing upserts on it any
-- more, and a deal created in the app has NULL here -- which stays distinct.
CREATE UNIQUE INDEX IF NOT EXISTS pm_crm_opps_ns_uniq
  ON pm_crm_opportunities (ns_opportunity_id);

CREATE TABLE IF NOT EXISTS pm_crm_opportunity_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES pm_crm_opportunities(id) ON DELETE CASCADE,
  ns_unique_key  text,
  line_number    integer,
  item_name      text,
  item_type      text,
  description    text,
  quantity       numeric,
  rate           numeric,
  amount         numeric,
  created_at     timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pm_crm_opp_lines_ns_uniq
  ON pm_crm_opportunity_lines (ns_unique_key);
CREATE INDEX IF NOT EXISTS pm_crm_opp_lines_opp
  ON pm_crm_opportunity_lines (opportunity_id);

CREATE TABLE IF NOT EXISTS pm_crm_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id text,
  contact_id     uuid REFERENCES pm_crm_contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES pm_crm_opportunities(id) ON DELETE CASCADE,
  title          text NOT NULL,
  notes          text,
  task_type      text DEFAULT 'todo'
                   CHECK (task_type IN ('todo','call','email','meeting','follow_up')),
  priority       text DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','in_progress','done','cancelled')),
  due_date       date,
  completed_at   timestamptz,
  assigned_to    text,
  created_by     text NOT NULL,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm_crm_activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id text,
  contact_id     uuid REFERENCES pm_crm_contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES pm_crm_opportunities(id) ON DELETE CASCADE,
  kind           text NOT NULL
                   CHECK (kind IN ('email','note','call','meeting','stage_change','task_done')),
  direction      text CHECK (direction IN ('inbound','outbound','internal')),
  subject        text,
  body           text,
  occurred_at    timestamptz NOT NULL,
  actor_email    text,
  actor_name     text,
  source         text NOT NULL DEFAULT 'app',
  -- Provenance on rows imported before activities became app-only. Nothing
  -- writes it now.
  ns_message_id  text,
  created_at     timestamptz DEFAULT now()
);

-- ─── Contacts are no longer synced ─────────────────────────────────────────
-- The unique index on ns_contact_id existed purely so the sync could upsert on
-- it. With no sync there is nothing to upsert, and keeping a uniqueness rule on
-- a provenance column would block someone legitimately re-entering a person.
DROP INDEX IF EXISTS cs_contacts_ns_uniq;
ALTER TABLE pm_crm_contacts DROP COLUMN IF EXISTS synced_at;

CREATE INDEX IF NOT EXISTS pm_crm_contacts_customer ON pm_crm_contacts (customer_ns_id);
CREATE INDEX IF NOT EXISTS pm_crm_contacts_name     ON pm_crm_contacts (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS pm_crm_contacts_email_uniq
  ON pm_crm_contacts (customer_ns_id, lower(email)) WHERE email IS NOT NULL;

-- ─── Activities are no longer seeded from NetSuite ─────────────────────────
-- The seed pulled 4,310 emails out of NetSuite's `message` table. Activities
-- are now app-only: what this application records is what appears. Already
-- imported rows stay — deleting correspondence history nobody asked to lose
-- would be the wrong way to honour "app-only".
DROP INDEX IF EXISTS crm_activities_ns_uniq;

CREATE INDEX IF NOT EXISTS pm_crm_activities_customer ON pm_crm_activities (customer_ns_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pm_crm_activities_contact  ON pm_crm_activities (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pm_crm_activities_opp      ON pm_crm_activities (opportunity_id, occurred_at DESC);

-- ─── Tasks were always app-only ────────────────────────────────────────────
-- Nothing to change beyond the name: NetSuite exposes no task, call or event
-- data to this integration and its `activity` view is empty, so there was never
-- anything to sync.
CREATE INDEX IF NOT EXISTS pm_crm_tasks_open     ON pm_crm_tasks (status, due_date)
  WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS pm_crm_tasks_customer ON pm_crm_tasks (customer_ns_id);
CREATE INDEX IF NOT EXISTS pm_crm_tasks_assignee ON pm_crm_tasks (lower(assigned_to), status);

-- ─── Opportunities are app-owned too ───────────────────────────────
-- The NetSuite link was removed in September 2026. The 295 deals imported
-- before then are kept, and ns_opportunity_id on those rows is provenance,
-- not a key: nothing matches on it and nothing overwrites them.
CREATE INDEX IF NOT EXISTS pm_crm_opps_customer ON pm_crm_opportunities (customer_ns_id);
CREATE INDEX IF NOT EXISTS pm_crm_opps_board    ON pm_crm_opportunities (stage_id, expected_close);

-- ─── Triggers follow the rename ────────────────────────────────────────────
DROP TRIGGER IF EXISTS crm_opps_touch  ON pm_crm_opportunities;
DROP TRIGGER IF EXISTS crm_tasks_touch ON pm_crm_tasks;

CREATE TRIGGER pm_crm_opps_touch BEFORE UPDATE ON pm_crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();
CREATE TRIGGER pm_crm_tasks_touch BEFORE UPDATE ON pm_crm_tasks
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

-- ─── Default stages, ONLY when the board has none ──────────────────────
-- Stages used to be seeded from NetSuite's entitystatus table by the sync.
-- With the sync gone a fresh database would have no columns at all and the
-- board would be unusable, so these seven stand in.
--
-- ⚠ The guard is WHERE NOT EXISTS over the WHOLE TABLE, not ON CONFLICT on the
-- id. An existing board carries ~30 NetSuite-derived stages under their own
-- ids, none of which collide with these; ON CONFLICT DO NOTHING would happily
-- add seven more columns beside them and split every deal's pipeline in two.
-- All-or-nothing is the only safe seed here.
INSERT INTO pm_crm_stages (id, name, entity_type, probability, sort_order, is_won, is_lost, is_open)
SELECT * FROM (VALUES
  ('qualifying',  'Qualifying',    'opportunity',  10::numeric, 10, false, false, true ),
  ('scoping',     'Scoping',       'opportunity',  25::numeric, 20, false, false, true ),
  ('proposal',    'Proposal Sent', 'opportunity',  50::numeric, 30, false, false, true ),
  ('negotiation', 'Negotiation',   'opportunity',  75::numeric, 40, false, false, true ),
  ('verbal',      'Verbal Yes',    'opportunity',  90::numeric, 50, false, false, true ),
  ('closed_won',  'Closed Won',    'opportunity', 100::numeric, 60, true,  false, false),
  ('closed_lost', 'Closed Lost',   'opportunity',   0::numeric, 70, false, true,  false)
) AS seed (id, name, entity_type, probability, sort_order, is_won, is_lost, is_open)
WHERE NOT EXISTS (SELECT 1 FROM pm_crm_stages);
