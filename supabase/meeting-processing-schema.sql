-- ─── Meeting processing state ─────────────────────────────────────────────────
-- Run in Supabase SQL Editor, after meeting-docs-schema.sql.
--
-- `meeting_docs` only records the Google Doc. That made every OTHER step of the
-- Process wizard invisible after a refresh: a meeting whose ClickUp tasks were
-- created and whose summary was posted to Slack, but where the PM skipped the
-- filing step, came back looking completely unprocessed — so it was easy to run
-- the whole thing twice and create duplicate tasks.
--
-- This table records all three steps against the Fireflies id, one row per
-- meeting, written server-side as each step completes (so a closed browser tab
-- doesn't lose the record of work that actually happened).

CREATE TABLE IF NOT EXISTS meeting_processing (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Fireflies transcript id — the natural key for a meeting.
  fireflies_id       text NOT NULL UNIQUE,

  meeting_title      text,
  meeting_date       timestamptz,
  meeting_type       text,
  project_ns_id      text,                -- NetSuite job.id it was processed against
  project_label      text,                -- "Client — Project" at time of processing

  -- Step 1 — ClickUp
  clickup_list_id    text,
  clickup_task_count integer NOT NULL DEFAULT 0,
  clickup_tasks      jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{id, name, url}]
  clickup_at         timestamptz,

  -- Step 2 — Slack
  slack_channel      text,
  slack_ts           text,
  slack_at           timestamptz,

  -- Step 3 — Google Drive. Duplicated from meeting_docs deliberately: this table
  -- answers "what happened to this meeting?" in one read, without a join, and
  -- survives meeting_docs being unavailable.
  doc_id             text,
  doc_url            text,
  doc_name           text,
  doc_at             timestamptz,

  processed_by       text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- The grid looks these up by Fireflies id in bulk, once per page load.
CREATE INDEX IF NOT EXISTS meeting_processing_fireflies ON meeting_processing(fireflies_id);
CREATE INDEX IF NOT EXISTS meeting_processing_project   ON meeting_processing(project_ns_id, meeting_date DESC);
