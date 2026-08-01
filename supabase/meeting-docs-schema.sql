-- ─── Filed meeting transcripts ────────────────────────────────────────────────
-- Run in Supabase SQL Editor.
--
-- Records which Fireflies meetings have already been filed to Google Drive, so the
-- grid can show a link instead of offering to create a duplicate. Drive itself
-- can't answer "has this meeting been filed?" without a per-row search, and the
-- filename alone is not a reliable key.

CREATE TABLE IF NOT EXISTS meeting_docs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Fireflies transcript id — the natural key for a meeting.
  fireflies_id      text NOT NULL UNIQUE,

  meeting_title     text,
  meeting_date      timestamptz,
  meeting_type      text NOT NULL,        -- e.g. "Project Management", "UAT"

  project_ns_id     text,                 -- NetSuite job.id the doc was filed against
  project_label     text,                 -- "Client — Project" at time of filing

  drive_folder_id   text NOT NULL,        -- the transcripts folder written into
  doc_id            text NOT NULL,
  doc_url           text NOT NULL,
  doc_name          text NOT NULL,

  created_by        text,
  created_at        timestamptz DEFAULT now()
);

-- The grid looks these up by Fireflies id in bulk.
CREATE INDEX IF NOT EXISTS meeting_docs_fireflies ON meeting_docs(fireflies_id);
CREATE INDEX IF NOT EXISTS meeting_docs_project   ON meeting_docs(project_ns_id, meeting_date DESC);
