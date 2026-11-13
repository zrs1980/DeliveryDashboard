-- ═══════════════════════════════════════════════════════════════════════════
-- Manually set project status (Projects tab)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor. Safe to re-run.
--
-- ─── Why ────────────────────────────────────────────────────────────────────
--
-- The On Track / At Risk / Critical badge used to be a computed health score
-- (budget burn vs ClickUp % done, SPI, overdue go-live). It ran on the
-- hand-maintained remaining-hours field and equal-weighted ClickUp task counts,
-- so it was often wrong in ways a PM could see at a glance. The PM now sets it.
--
-- One row per NetSuite project. No row = "Not set", which renders grey rather
-- than defaulting to green, so nothing looks healthy by accident. Clearing a
-- status deletes the row.

CREATE TABLE IF NOT EXISTS project_status (
  ns_project_id  integer PRIMARY KEY,
  status         text NOT NULL CHECK (status IN ('green', 'yellow', 'red')),
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Reached only through the service-role client, so RLS would be decorative.
