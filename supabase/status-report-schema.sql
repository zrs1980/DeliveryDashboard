-- ─── Weekly Project Status Report Schema ──────────────────────────────────────
-- Run in Supabase SQL Editor after pm-schema.sql
--
-- Backs the PM "Weekly Status Report" wizard. Two concerns:
--
--  1. pm_status_reports        — one saved snapshot per project per week. The full
--                                edited report lives in `content` (JSONB) so the PM
--                                can reopen a draft, and so next week's report can
--                                diff against last week's numbers.
--
--  2. pm_status_report_baselines — the ORIGINAL milestone due dates and phase
--                                allocated hours, captured the first time a report
--                                is generated for a project. Neither NetSuite nor
--                                ClickUp keeps prior values, so without this the
--                                "Orig. Due Date" column and the "114 (adjusted
--                                from 130)" budget annotations in the deck template
--                                cannot be reproduced.

-- ─── Saved reports ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pm_status_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  project_ns_id  text NOT NULL,          -- NetSuite job.id (or pm_projects.id for native-only)
  week_ending    date NOT NULL,          -- Friday of the reporting week
  content        jsonb NOT NULL,         -- full StatusReport object (see lib/status-report.ts)

  status         text NOT NULL DEFAULT 'draft',  -- draft | final
  overall_status text,                    -- on_track | at_risk | critical (denormalised for trend queries)

  created_by     text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),

  UNIQUE (project_ns_id, week_ending)
);

CREATE INDEX IF NOT EXISTS pm_status_reports_project ON pm_status_reports(project_ns_id, week_ending DESC);

-- ─── Baselines ────────────────────────────────────────────────────────────────
-- One row per tracked item. kind distinguishes what the baseline refers to:
--   'milestone' → ref_id = ClickUp task id / pm_tasks uuid, baseline_date = original due date
--   'phase'     → ref_id = NetSuite projecttask.id,          baseline_hours = original allocated hours

CREATE TABLE IF NOT EXISTS pm_status_report_baselines (
  project_ns_id  text NOT NULL,
  kind           text NOT NULL,          -- milestone | phase
  ref_id         text NOT NULL,
  label          text,                   -- name at time of capture, for display if the source is deleted

  baseline_date  date,                    -- milestones
  baseline_hours numeric,                 -- phases

  captured_at    timestamptz DEFAULT now(),

  PRIMARY KEY (project_ns_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS pm_status_report_baselines_project
  ON pm_status_report_baselines(project_ns_id);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pm_status_reports_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pm_status_reports_touch_trg ON pm_status_reports;
CREATE TRIGGER pm_status_reports_touch_trg
  BEFORE UPDATE ON pm_status_reports
  FOR EACH ROW EXECUTE FUNCTION pm_status_reports_touch();
