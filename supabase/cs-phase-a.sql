-- ═══════════════════════════════════════════════════════════════════════════
-- CS Phase A — contact roles, opt-out, and active negotiation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor, after cs-agent-schema.sql,
-- crm-schema.sql and pm-crm-rename.sql. Safe to re-run.
--
-- docs/08-CSM-AGENT.md Phase A. Two suppression checks have been reporting
-- `skipped` since the day they were written because the columns they need do
-- not exist. This adds them.

-- ─── Opt-out ───────────────────────────────────────────────────────────────
-- `04-DRAFT-QUEUE.md` lists "Customer opted out → Block, permanently" and it
-- has never been enforceable. `lib/cs-suppression.ts` says so out loud:
-- skip("opted_out", "No opt-out field exists on the schema yet.").
--
-- ⚠ ON THE CONTACT, NOT THE CUSTOMER, DELIBERATELY. Opting out is a person's
-- decision about their own inbox. One person at an account asking to be left
-- alone must not silently mute their colleagues, and must not be undone by
-- someone editing the account.
ALTER TABLE pm_crm_contacts ADD COLUMN IF NOT EXISTS opted_out       boolean NOT NULL DEFAULT false;
ALTER TABLE pm_crm_contacts ADD COLUMN IF NOT EXISTS opted_out_at    timestamptz;
ALTER TABLE pm_crm_contacts ADD COLUMN IF NOT EXISTS opt_out_reason  text;

CREATE INDEX IF NOT EXISTS pm_crm_contacts_opted_out
  ON pm_crm_contacts (customer_ns_id) WHERE opted_out;

-- ─── Suggested roles ───────────────────────────────────────────────────────
-- `role` drives who the CSM agent may write to, and it is `unknown` on almost
-- every contact. It cannot be imported: NetSuite's own `contactrole` is set on
-- 22 of 949 contacts and its values are built-in negative ids whose labels
-- SuiteQL cannot resolve at all (verified September 2026).
--
-- ⚠ A SUGGESTION IS NOT A ROLE, AND LIVES IN ITS OWN COLUMN. Writing an
-- inferred role straight into `role` would make a guess indistinguishable from
-- a human decision the moment it was written — and `role` is what decides
-- whether we are allowed to email someone. Accepting a suggestion copies it
-- across and clears these; until then `role` stays `unknown` and the contact
-- stays unusable for outreach. That is the correct default.
ALTER TABLE pm_crm_contacts ADD COLUMN IF NOT EXISTS suggested_role        text
  CHECK (suggested_role IS NULL OR suggested_role IN
    ('economic_buyer','champion','admin','end_user','technical','unknown'));
ALTER TABLE pm_crm_contacts ADD COLUMN IF NOT EXISTS suggested_role_reason text;
ALTER TABLE pm_crm_contacts ADD COLUMN IF NOT EXISTS suggested_at          timestamptz;

CREATE INDEX IF NOT EXISTS pm_crm_contacts_suggested
  ON pm_crm_contacts (customer_ns_id) WHERE suggested_role IS NOT NULL;

-- ─── Active negotiation ────────────────────────────────────────────────────
-- The other permanently-skipped check. `04-DRAFT-QUEUE.md`: "Active commercial
-- negotiation in progress → Block". A health-check email landing mid-negotiation
-- is at best noise and at worst leverage handed away.
--
-- ⚠ ON THE PROFILE RATHER THAN A NEW `cs_account_state` TABLE. 08 offers both.
-- The profile is already one row per customer, already CS-owned, already behind
-- cs_layer, and already has the human_verified/human_notes convention for
-- things a person asserts rather than the extractor. A new table would be a
-- second place to look for per-customer CS state.
--
-- ⚠ SET BY A HUMAN ONLY. Re-extraction must never touch these three columns,
-- for the same reason it must never touch human_notes.
ALTER TABLE cs_customer_profiles ADD COLUMN IF NOT EXISTS active_negotiation      boolean NOT NULL DEFAULT false;
ALTER TABLE cs_customer_profiles ADD COLUMN IF NOT EXISTS active_negotiation_note text;
ALTER TABLE cs_customer_profiles ADD COLUMN IF NOT EXISTS active_negotiation_at   timestamptz;
ALTER TABLE cs_customer_profiles ADD COLUMN IF NOT EXISTS active_negotiation_by   text;
