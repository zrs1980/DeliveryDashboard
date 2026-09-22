-- ═══════════════════════════════════════════════════════════════════════════
-- CRM associations — the deal ↔ contact layer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor, after crm-schema.sql and
-- pm-crm-rename.sql. Safe to re-run.
--
-- WHY THIS TABLE EXISTS
--
-- Every other relationship in this CRM is a single column: a task has one
-- opportunity_id, an activity has one contact_id. That works because those are
-- genuinely one-to-one. A deal's people are not: an implementation deal has a
-- sponsor, a budget holder, an IT contact and usually someone quietly against
-- it, and `pm_crm_opportunities.primary_contact_id` can hold exactly one of
-- them. Everyone else was invisible.
--
-- This is the thing HubSpot calls an association, and the labelled variety is
-- the half that carries the meaning. An unlabelled list of five names on a deal
-- tells you nothing you could act on.
--
-- ⚠ THE DEAL LABEL IS NOT THE CONTACT'S ROLE, AND THEY ARE DELIBERATELY
-- SEPARATE FIELDS. `pm_crm_contacts.role` is what this person is TO THE
-- ACCOUNT — it is set once and drives the champion-silence signal. The label
-- here is what they are TO THIS DEAL. The same person is routinely the
-- account's champion and a blocker on one specific piece of work, and
-- collapsing the two would lose whichever was written second.

CREATE TABLE IF NOT EXISTS pm_crm_deal_contacts (
  opportunity_id uuid NOT NULL REFERENCES pm_crm_opportunities(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES pm_crm_contacts(id)      ON DELETE CASCADE,
  label          text NOT NULL DEFAULT 'unlabeled'
                   CHECK (label IN ('decision_maker','budget_holder','champion',
                                    'influencer','technical','billing',
                                    'blocker','point_of_contact','unlabeled')),
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now(),
  created_by     text,
  PRIMARY KEY (opportunity_id, contact_id)
);

-- One primary per deal. Partial, because the constraint is "at most one TRUE",
-- not "at most one row per deal" — every non-primary row would collide on a
-- plain index.
CREATE UNIQUE INDEX IF NOT EXISTS pm_crm_deal_contacts_primary
  ON pm_crm_deal_contacts (opportunity_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS pm_crm_deal_contacts_contact
  ON pm_crm_deal_contacts (contact_id);

-- ─── Backfill from primary_contact_id ──────────────────────────────────────
-- The single-contact column is not dropped: it is still what the pipeline card
-- reads, and dropping it would be a breaking change for a gain of one column.
-- It becomes a denormalised cache of "the row where is_primary" — the API keeps
-- the two in step on every write.
--
-- ON CONFLICT DO NOTHING so a re-run cannot overwrite a label someone has since
-- set by hand. The backfill is a starting point, not a source of truth.
INSERT INTO pm_crm_deal_contacts (opportunity_id, contact_id, label, is_primary, created_by)
SELECT o.id, o.primary_contact_id, 'point_of_contact', true, 'backfill'
FROM pm_crm_opportunities o
WHERE o.primary_contact_id IS NOT NULL
ON CONFLICT (opportunity_id, contact_id) DO NOTHING;

-- ─── Deal activity recency ─────────────────────────────────────────────────
-- HubSpot surfaces deal inactivity on the board, and it is the most useful
-- single number on a pipeline: a deal nobody has touched in six weeks is the
-- one to look at, whatever stage it claims to be in.
--
-- Derived at read time from pm_crm_activities rather than stored, for the same
-- reason the renewal clock is derived — a stored "days since" is wrong by one
-- every midnight. This index is what makes that read cheap.
CREATE INDEX IF NOT EXISTS pm_crm_activities_opp_recent
  ON pm_crm_activities (opportunity_id, occurred_at DESC)
  WHERE opportunity_id IS NOT NULL;
