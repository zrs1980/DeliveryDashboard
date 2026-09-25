-- ═══════════════════════════════════════════════════════════════════════════
-- CSM agent — runs, human flags, and the draft columns 08 asks for
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor, after cs-agent-schema.sql and
-- cs-research-schema.sql. Safe to re-run.
--
-- docs/08-CSM-AGENT.md Phase D.

-- ─── Runs ──────────────────────────────────────────────────────────────────
-- One row per account the agent looks at, whatever it decides.
--
-- ⚠ A SKIP IS A REAL OUTCOME, NOT A FAILED RUN. "Nothing specific to say" on an
-- account that keeps getting flagged is one of the more useful things this
-- system can tell you: it means the profile is too thin to act on. Storing
-- skips with their category is what makes that visible instead of looking like
-- the agent did nothing.
CREATE TABLE IF NOT EXISTS cs_agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id text NOT NULL,
  customer_name  text,

  trigger        text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','nightly')),
  status         text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','complete','stopped','failed')),
  -- What it decided. Null while running, and on a run that never decided.
  outcome        text CHECK (outcome IS NULL OR outcome IN ('proposed','skipped','blocked')),

  skip_category  text CHECK (skip_category IS NULL OR skip_category IN
                   ('recently_contacted','we_owe_them','nothing_specific_to_say',
                    'no_suitable_contact','not_the_right_time','other')),
  skip_reason    text,

  draft_id       uuid REFERENCES cs_outreach_drafts(id) ON DELETE SET NULL,

  -- Raised when an email is the wrong response and a person should step in.
  -- Separate from the draft: this is explicitly NOT outreach.
  human_flag     jsonb,

  -- Every tool call with its input and a truncated result. This is how the
  -- agent gets debugged — without it you are guessing why it decided something,
  -- and a decision agent you cannot interrogate is one you cannot trust.
  transcript     jsonb NOT NULL DEFAULT '[]'::jsonb,

  tool_calls     integer NOT NULL DEFAULT 0,
  duration_ms    integer,
  -- 'done' | 'tool_budget' | 'time_budget' | 'no_submit' | 'error'. A run that
  -- ran out of budget must never read as a considered decision.
  stop_reason    text,
  model          text,
  -- Bumped on every prompt change, so outcomes can be compared across versions.
  prompt_version text,
  input_tokens   integer,
  output_tokens  integer,
  error          text,

  run_by         text,
  queued_at      timestamptz DEFAULT now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS cs_agent_runs_customer ON cs_agent_runs (customer_ns_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS cs_agent_runs_queue    ON cs_agent_runs (status, queued_at);
CREATE INDEX IF NOT EXISTS cs_agent_runs_outcome  ON cs_agent_runs (outcome, completed_at DESC);

-- ─── Draft columns 08 asks for ─────────────────────────────────────────────
-- `lint` has been COMPUTED SINCE THE HEALTH-CHECK MOTION WAS BUILT and thrown
-- away every time: it was returned in the generating request's HTTP response
-- and never written, so the Draft Queue — the screen that exists to review
-- drafts — has never once seen a lint hit.
ALTER TABLE cs_outreach_drafts ADD COLUMN IF NOT EXISTS lint jsonb DEFAULT '[]'::jsonb;

-- Claims in the body that the cited facts do not support. A reviewer aid, not
-- the guarantee: the real guarantee is that the model was never shown
-- unverified material in the first place.
ALTER TABLE cs_outreach_drafts ADD COLUMN IF NOT EXISTS unsupported_claims jsonb DEFAULT '[]'::jsonb;

ALTER TABLE cs_outreach_drafts ADD COLUMN IF NOT EXISTS agent_run_id uuid
  REFERENCES cs_agent_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cs_drafts_agent_run ON cs_outreach_drafts (agent_run_id);
