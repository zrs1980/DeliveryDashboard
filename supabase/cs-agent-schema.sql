-- ─── Customer Success Agent Layer — Phase 0 schema ─────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE.
--
-- WARNING - RUN ORDER ON A FRESH DATABASE: this file FIRST, then
--   crm-schema.sql, then pm-crm-rename.sql. This file creates `cs_contacts`;
--   pm-crm-rename.sql renames it to `pm_crm_contacts`. Run in the other order
--   and the rename finds nothing to rename, this file then creates
--   `cs_contacts` fresh, and you end up with TWO contact tables with half the
--   application reading the empty one.
--
-- Spec: docs/01-DATA-MODEL.md. Survey and adaptations: the Phase 0 report.
--
-- Required env var to add in Vercel (Production, Preview, Development):
--   CRON_SECRET  — bearer token Vercel Cron presents to /api/cs/cron/health
--
-- ─── Two conventions that are load-bearing ─────────────────────────────────
--
-- 1. `cs_` prefix. The spec draws a hard line between the SYSTEM OF RECORD
--    (human-entered facts) and the SYSTEM OF ATTENTION (agent opinions). The
--    prefix makes that seam visible at schema level, and keeps `cs_health_*`
--    from ever being mistaken for the existing `healthchecks` table — which is
--    quarterly call SCHEDULING and has nothing to do with scoring.
--
-- 2. `customer_ns_id text` with no foreign key. The customer master is NetSuite,
--    not Postgres; there is no `customers` table to point at. This matches the
--    existing convention in healthchecks, customer_portal_users,
--    project_portal_access, task_approvals and portal_invitations. The id is the
--    NetSuite `customer` internal id, stored as text.
--
-- NOTE ON ROLLUPS, for anything that later queries hours by customer:
--   `timebill.customer` is a JOB id, not a customer id. Roll up through
--   timebill.customer -> job.id -> job.customer, filter `timetype = 'A'`, and
--   exclude LEAVE_PROJECT_IDS. Measured on the live account: without the
--   timetype filter, 17,017 of 32,308 rows are forward-dated allocations and a
--   silent account reads as active.

-- ═══ SYSTEM OF RECORD ═══════════════════════════════════════════════════════
-- Human-entered or synced facts. Trustworthy. Never written by the agent.

-- What each customer is contracted for, and when it actually has to be renewed.
-- Nothing in the dashboard knows this today, and the renewal motion is dead
-- without it. Also the gate that makes health scoring usable: 95 of 111
-- customers have no hours in 90+ days because their implementation finished, and
-- only a contract distinguishes those from an account going quiet.
CREATE TABLE IF NOT EXISTS cs_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id     text NOT NULL,
  customer_name      text NOT NULL,
  product            text NOT NULL CHECK (product IN ('netsuite','loop_erp','services','other')),
  start_date         date,
  end_date           date,
  -- The real deadline. Notice is almost always due before end_date, and missing
  -- it auto-renews the contract — so alerts count down to this, not to end_date.
  notice_period_days integer DEFAULT 0,
  auto_renew         boolean DEFAULT false,
  annual_value       numeric,
  seat_count         integer,
  licence_count      integer,
  -- NetSuite modules / SuiteApps / Loop modules. Array rather than a join table:
  -- this is read whole and never queried by element.
  modules            text[] DEFAULT '{}',
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','pending_renewal','renewed','churned')),
  source             text,
  notes              text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cs_contracts_customer ON cs_contracts(customer_ns_id);
CREATE INDEX IF NOT EXISTS cs_contracts_status   ON cs_contracts(status, end_date);

-- People, with role and liveness. A departing champion is one of the strongest
-- churn signals available and is invisible without this.
CREATE TABLE IF NOT EXISTS cs_contacts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id       text NOT NULL,
  name                 text NOT NULL,
  email                text,
  job_title            text,
  role                 text NOT NULL DEFAULT 'unknown'
                         CHECK (role IN ('economic_buyer','champion','admin','end_user','technical','unknown')),
  is_active            boolean DEFAULT true,
  first_seen_at        timestamptz,
  -- Most recent appearance in any ticket, meeting or thread.
  last_seen_at         timestamptz,
  -- When the system first noticed them going quiet — not when they left.
  departed_detected_at timestamptz,
  notes                text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cs_contacts_customer ON cs_contacts(customer_ns_id);
CREATE INDEX IF NOT EXISTS cs_contacts_role     ON cs_contacts(customer_ns_id, role) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS cs_contacts_email_uniq ON cs_contacts(customer_ns_id, lower(email)) WHERE email IS NOT NULL;

-- Who owes what to whom, by when. Both directions — an overdue `we_owe` is both
-- a health signal and a hard block on asking that customer for anything.
CREATE TABLE IF NOT EXISTS cs_commitments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id     text NOT NULL,
  direction          text NOT NULL CHECK (direction IN ('we_owe','they_owe')),
  description        text NOT NULL,
  due_date           date,
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','done','slipped','cancelled')),
  -- Where it came from: the call, email or ticket.
  source_type        text,
  source_id          text,
  -- 'agent' or an email address. Agent-extracted commitments are not facts until
  -- a human confirms them, hence the flag below.
  created_by         text NOT NULL DEFAULT 'agent',
  confirmed_by_human boolean DEFAULT false,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cs_commitments_customer ON cs_commitments(customer_ns_id, status);
CREATE INDEX IF NOT EXISTS cs_commitments_due      ON cs_commitments(status, due_date);

-- The cheapest high-value signal in the package, and the only route to
-- relational context given there is no product telemetry. One optional prompt at
-- time entry or project close. An amber from a consultant who has been on site
-- outranks any derived metric here.
CREATE TABLE IF NOT EXISTS cs_consultant_sentiment (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id text NOT NULL,
  project_ns_id  text,
  consultant_ns_id integer NOT NULL,
  consultant_name  text,
  rating         text NOT NULL CHECK (rating IN ('green','amber','red')),
  note           text,
  captured_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cs_sentiment_customer ON cs_consultant_sentiment(customer_ns_id, captured_at DESC);

-- ═══ SYSTEM OF ATTENTION ════════════════════════════════════════════════════
-- Agent-generated opinions. Always attributed, always timestamped, always
-- reviewable. Never merged into the tables above.

-- One current profile per customer. Everything downstream — release matching,
-- QBR content, health-check copy — depends on this being right.
CREATE TABLE IF NOT EXISTS cs_customer_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id      text NOT NULL,
  customer_name       text NOT NULL,
  modules_owned       text[] DEFAULT '{}',
  netsuite_edition    text,
  netsuite_version    text,
  integrations        text[] DEFAULT '{}',
  -- jsonb, not text[]: each of these carries evidence refs and a confidence
  -- level per item, and the UI has to drill from a claim back to the record.
  customisations      jsonb DEFAULT '[]'::jsonb,
  -- [{description, evidence_refs[], confidence, first_seen}]
  pain_points         jsonb DEFAULT '[]'::jsonb,
  -- The cross-sell targets. Highest-value extraction in the spec.
  manual_processes    jsonb DEFAULT '[]'::jsonb,
  -- Negative space: asked about, never bought. Drives targeting AND suppression.
  features_enquired_not_purchased jsonb DEFAULT '[]'::jsonb,
  -- [{item, reason, date}] — suppression input.
  declined_items      jsonb DEFAULT '[]'::jsonb,
  industry            text,
  company_size        text,
  extracted_at        timestamptz DEFAULT now(),
  extraction_version  text,
  human_verified      boolean DEFAULT false,
  -- Re-extraction must never overwrite this, or the human_verified fields.
  human_notes         text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
-- One current profile per customer; history lives in the extraction log, not here.
CREATE UNIQUE INDEX IF NOT EXISTS cs_profiles_customer_uniq ON cs_customer_profiles(customer_ns_id);

-- Append-only, one row per customer per run. The history IS the point: a stable
-- 65 is fine, 85 -> 65 in a month is not.
CREATE TABLE IF NOT EXISTS cs_health_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id text NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  score          integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  band           text NOT NULL CHECK (band IN ('healthy','watch','at_risk','critical')),
  -- Every signal evaluated, with its raw value, threshold and pass/fail. Without
  -- this a score cannot be explained, and a score that cannot be explained gets
  -- trusted anyway — which is worse than having none.
  signals        jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules_version  text,
  previous_score integer,
  delta          integer
);
CREATE INDEX IF NOT EXISTS cs_health_snapshots_customer ON cs_health_snapshots(customer_ns_id, computed_at DESC);
-- Retention: daily for 90 days, then weekly rollups. Not enforced here — add the
-- prune to the nightly job once there is enough history to roll up.

-- Discrete issues with a lifecycle and an owner. Distinct from the score.
CREATE TABLE IF NOT EXISTS cs_health_flags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id   text NOT NULL,
  rule_id          text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title            text NOT NULL,
  reason           text NOT NULL,
  -- Record ids and values that triggered it. Must support drill-down.
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','acknowledged','actioned','resolved','dismissed')),
  raised_at        timestamptz DEFAULT now(),
  resolved_at      timestamptz,
  dismissed_reason text,
  -- Suppress this rule for this account until this date, set on dismissal.
  suppressed_until date,
  updated_at       timestamptz DEFAULT now()
);
-- Idempotency: re-running the nightly job updates the OPEN flag for a
-- (customer, rule) rather than stacking duplicates. Partial unique index because
-- the same rule may legitimately be raised again after an earlier one resolved.
CREATE UNIQUE INDEX IF NOT EXISTS cs_health_flags_open_uniq
  ON cs_health_flags(customer_ns_id, rule_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS cs_health_flags_triage ON cs_health_flags(status, severity);

-- The control surface. Every outbound communication lands here first, and
-- nothing leaves without explicit human approval — permanently, not as a v1
-- safety measure. See docs/04-DRAFT-QUEUE.md.
CREATE TABLE IF NOT EXISTS cs_outreach_drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id     text NOT NULL,
  -- WARNING - NO INLINE FOREIGN KEY, DELIBERATELY. This used to read
  --   `REFERENCES cs_contacts(id)`, which was correct when written and then
  --   quietly became a lie: pm-crm-rename.sql renames that table to
  --   pm_crm_contacts. Postgres carries the FK through a rename so live
  --   databases were fine, but a fresh database run in the wrong order failed
  --   outright on a table that no longer gets created.
  --   The constraint is attached at the end of pm-crm-rename.sql instead,
  --   where the final table name is actually known.
  contact_id         uuid,
  motion             text NOT NULL
                       CHECK (motion IN ('health_check','qbr','release','renewal','commitment_followup')),
  subject            text NOT NULL,
  body               text NOT NULL,
  attachments        jsonb DEFAULT '[]'::jsonb,
  -- Why this customer, why now. Shown to the reviewer. Non-negotiable field.
  rationale          text NOT NULL,
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','approved','edited','sent','rejected','expired','snoozed')),
  -- Retained when edited. The diff between generated and sent is the highest-
  -- value training data in the system — never overwrite it.
  original_body      text,
  -- Which suppression rules were evaluated and what they returned.
  suppression_checks jsonb DEFAULT '{}'::jsonb,
  rejection_reason   text,
  generated_at       timestamptz DEFAULT now(),
  -- A health-check reference three weeks stale is worse than no email.
  expires_at         timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        text,
  sent_at            timestamptz,
  snoozed_until      timestamptz
);
CREATE INDEX IF NOT EXISTS cs_drafts_queue    ON cs_outreach_drafts(status, generated_at DESC);
CREATE INDEX IF NOT EXISTS cs_drafts_customer ON cs_outreach_drafts(customer_ns_id, generated_at DESC);

-- Parsed release note entries — NetSuite twice a year, Loop ERP as shipped.
CREATE TABLE IF NOT EXISTS cs_release_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product           text NOT NULL CHECK (product IN ('netsuite','loop_erp')),
  release_version   text NOT NULL,
  release_date      date,
  title             text NOT NULL,
  description       text,
  source_url        text,
  modules_affected  text[] DEFAULT '{}',
  -- Structured conditions the matcher evaluates against a customer profile.
  relevance_criteria jsonb DEFAULT '{}'::jsonb,
  category          text CHECK (category IN ('new_feature','enhancement','deprecation','breaking_change')),
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cs_release_items_release ON cs_release_items(product, release_version);

-- Per-customer relevance. `reasoning` is customer-specific and appears verbatim
-- in the PDF — it is the entire differentiator, so it is stored, not recomputed.
CREATE TABLE IF NOT EXISTS cs_release_matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_item_id  uuid NOT NULL REFERENCES cs_release_items(id) ON DELETE CASCADE,
  customer_ns_id   text NOT NULL,
  relevance_score  numeric,
  reasoning        text,
  -- Which profile attributes drove the match — shown in the curation matrix.
  matched_on       jsonb DEFAULT '{}'::jsonb,
  included_in_pdf  boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cs_release_matches_uniq ON cs_release_matches(release_item_id, customer_ns_id);
CREATE INDEX IF NOT EXISTS cs_release_matches_customer ON cs_release_matches(customer_ns_id);

-- ─── updated_at triggers (matching the pm-schema convention) ────────────────

CREATE OR REPLACE FUNCTION cs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS cs_contracts_updated_at ON cs_contracts;
CREATE TRIGGER cs_contracts_updated_at
  BEFORE UPDATE ON cs_contracts
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

DROP TRIGGER IF EXISTS cs_contacts_updated_at ON cs_contacts;
CREATE TRIGGER cs_contacts_updated_at
  BEFORE UPDATE ON cs_contacts
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

DROP TRIGGER IF EXISTS cs_commitments_updated_at ON cs_commitments;
CREATE TRIGGER cs_commitments_updated_at
  BEFORE UPDATE ON cs_commitments
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

DROP TRIGGER IF EXISTS cs_profiles_updated_at ON cs_customer_profiles;
CREATE TRIGGER cs_profiles_updated_at
  BEFORE UPDATE ON cs_customer_profiles
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

DROP TRIGGER IF EXISTS cs_health_flags_updated_at ON cs_health_flags;
CREATE TRIGGER cs_health_flags_updated_at
  BEFORE UPDATE ON cs_health_flags
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

-- ─── Access control ─────────────────────────────────────────────────────────
--
-- These tables are reached exclusively through the service-role client
-- (lib/supabase.ts), which bypasses RLS, so RLS is deliberately NOT enabled —
-- it would be decorative. The real boundary is server-side in
-- lib/cs-permissions.ts: every CS route calls requireCsLayer() before touching
-- anything here.
--
-- If a customer-facing surface is ever built on these tables (it is out of scope
-- for v1), RLS must be added first — follow supabase/portal-schema.sql, which is
-- the only part of this system with database-enforced authorisation.
