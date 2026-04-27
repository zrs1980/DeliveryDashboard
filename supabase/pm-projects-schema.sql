-- ─── Native PM Projects ──────────────────────────────────────────────────────
-- Run in Supabase SQL Editor after pm-schema.sql

CREATE TABLE IF NOT EXISTS pm_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  client_name   text NOT NULL,
  project_type  text NOT NULL DEFAULT 'Implementation',  -- Implementation | Service
  pm_name       text,
  ns_project_id text,          -- optional link to NS job internal ID
  go_live_date  date,
  budget_hours  numeric,
  description   text,
  status        text NOT NULL DEFAULT 'active',  -- active | on_hold | completed | archived
  created_by    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pm_projects_ns ON pm_projects(ns_project_id);
CREATE INDEX IF NOT EXISTS pm_projects_status ON pm_projects(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION pm_projects_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS pm_projects_updated_at ON pm_projects;
CREATE TRIGGER pm_projects_updated_at
  BEFORE UPDATE ON pm_projects
  FOR EACH ROW EXECUTE FUNCTION pm_projects_set_updated_at();
