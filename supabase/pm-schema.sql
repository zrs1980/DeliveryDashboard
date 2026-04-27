-- ─── Native Project Management Schema ─────────────────────────────────────────
-- Run in Supabase SQL Editor after portal-schema.sql

-- Phases within a project (maps to CEBA 5-phase delivery structure)
CREATE TABLE IF NOT EXISTS pm_phases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_ns_id text NOT NULL,
  name          text NOT NULL,
  phase_number  integer,          -- 1–5, 0 = PM/Admin, 99 = Backlog
  sort_order    integer DEFAULT 0,
  color         text,
  ns_phase_id   integer,          -- optional link to NS projecttask.id
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_phases_project ON pm_phases(project_ns_id);

-- Tasks
CREATE TABLE IF NOT EXISTS pm_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id        uuid REFERENCES pm_phases(id) ON DELETE CASCADE,
  project_ns_id   text NOT NULL,
  parent_task_id  uuid REFERENCES pm_tasks(id) ON DELETE SET NULL,

  title           text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'new',
  priority        text NOT NULL DEFAULT 'normal',  -- urgent | high | normal | low

  assignee_ns_id  integer,
  assignee_name   text,

  due_date        date,
  time_estimate   numeric,          -- hours
  time_logged     numeric DEFAULT 0, -- hours (sum of pm_time_entries)

  sort_order      integer DEFAULT 0,
  clickup_task_id text,             -- populated on import
  is_customer_visible boolean DEFAULT true,

  created_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_tasks_phase    ON pm_tasks(phase_id);
CREATE INDEX IF NOT EXISTS pm_tasks_project  ON pm_tasks(project_ns_id);
CREATE INDEX IF NOT EXISTS pm_tasks_parent   ON pm_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS pm_tasks_clickup  ON pm_tasks(clickup_task_id);

-- Dependencies (task A blocked by task B)
CREATE TABLE IF NOT EXISTS pm_task_dependencies (
  task_id        uuid NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
  depends_on_id  uuid NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);

-- Time entries logged against tasks
CREATE TABLE IF NOT EXISTS pm_time_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
  logged_by   text NOT NULL,
  hours       numeric NOT NULL,
  note        text,
  logged_date date DEFAULT CURRENT_DATE,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_time_entries_task ON pm_time_entries(task_id);

-- Auto-update updated_at on pm_tasks
CREATE OR REPLACE FUNCTION pm_tasks_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS pm_tasks_updated_at ON pm_tasks;
CREATE TRIGGER pm_tasks_updated_at
  BEFORE UPDATE ON pm_tasks
  FOR EACH ROW EXECUTE FUNCTION pm_tasks_set_updated_at();
