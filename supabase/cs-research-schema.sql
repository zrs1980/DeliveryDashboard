-- ═══════════════════════════════════════════════════════════════════════════
-- CS research agent — stored runs, and a new draft motion
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor, after cs-agent-schema.sql.
-- Safe to re-run.

-- ─── Runs are stored, not recomputed ───────────────────────────────────────
-- A run costs a chain of model calls plus a walk over Drive, ClickUp and
-- SuiteQL. Re-reading the findings must not mean paying for that again, and the
-- evidence has to stay pinned to what was actually read at the time — a finding
-- whose evidence has been re-derived from today's data is no longer the finding
-- that was reviewed.
--
-- ⚠ AGENT OUTPUT, NEVER A SYSTEM OF RECORD. Every row is attributed, timestamped
-- and reviewable, and nothing downstream may treat a finding as fact. Same rule
-- as profiles, flags and drafts — the cs_ prefix marks the seam.
CREATE TABLE IF NOT EXISTS cs_research_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id text NOT NULL,
  customer_name  text,

  status         text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','complete','failed','stopped')),
  -- Why it ended: 'done' | 'tool_budget' | 'time_budget' | 'error'. A run that
  -- hit a bound produced a PARTIAL answer and the UI has to say so, rather than
  -- presenting a truncated look at the evidence as a considered conclusion.
  stop_reason    text,

  summary        text,
  -- [{ title, detail, confidence, evidence: [{ kind, ref, label }] }]
  findings       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ action, rationale, chargeable }]
  next_steps     jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- What it actually looked at. This is what makes a thin answer auditable:
  -- "it found little" and "there was little to find" are different, and only
  -- the read log tells them apart.
  sources_read   jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_calls     integer NOT NULL DEFAULT 0,
  duration_ms    integer,
  model          text,
  error          text,

  run_by         text,
  created_at     timestamptz DEFAULT now(),
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS cs_research_customer
  ON cs_research_runs (customer_ns_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cs_research_status
  ON cs_research_runs (status, created_at DESC);

-- ─── 'research' joins the draft motions ────────────────────────────────────
-- The agent PROPOSES outreach; it never sends. A proposal lands in the same
-- queue behind the same human approval as every other motion, so there is one
-- place where things get approved rather than a second path with its own rules.
--
-- Dropping and re-adding is the only way to widen a CHECK in Postgres. Named
-- explicitly so a re-run replaces it rather than stacking a second constraint.
ALTER TABLE cs_outreach_drafts DROP CONSTRAINT IF EXISTS cs_outreach_drafts_motion_check;
ALTER TABLE cs_outreach_drafts ADD  CONSTRAINT cs_outreach_drafts_motion_check
  CHECK (motion IN ('health_check','qbr','release','renewal','commitment_followup','research'));

-- Links a draft back to the run that proposed it, so a reviewer can see the
-- evidence rather than judging the email on its own.
ALTER TABLE cs_outreach_drafts ADD COLUMN IF NOT EXISTS research_run_id uuid
  REFERENCES cs_research_runs(id) ON DELETE SET NULL;
