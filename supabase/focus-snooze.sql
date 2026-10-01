-- ═══════════════════════════════════════════════════════════════════════════
-- Snoozing a Focus row
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor. Safe to re-run.
--
-- ─── Why ────────────────────────────────────────────────────────────────────
--
-- Triage can dismiss a flag with a reason and suppress it for 90 days. Focus
-- could not dismiss anything, so an account you had consciously decided not to
-- call came back tomorrow, and the next day, identically. That is the specific
-- mechanism by which a worklist stops being read — and now that the morning
-- digest draws from the same sections, it is also how a daily message turns
-- into noise.
--
-- ⚠ A REASON IS REQUIRED, exactly as it is for a flag. It is the only feedback
-- on whether a section is any good: a row dismissed as "not a real customer"
-- fifty times means the gate is wrong, and without the reason that signal does
-- not exist. The CHECK enforces it rather than trusting a route.
--
-- ⚠ SNOOZE, NOT DELETE. The row comes back when the suppression expires,
-- because the underlying fact usually has not changed — the account is still
-- quiet, the check is still unbooked. Hiding it forever would quietly shrink
-- the book nobody is watching.

CREATE TABLE IF NOT EXISTS cs_focus_snoozes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id  text NOT NULL,
  -- Matches FocusKind in lib/cs-focus.ts. Deliberately NOT a CHECK against a
  -- fixed list: a new section should not need a migration before it can be
  -- snoozed, and an unknown kind here is harmless — it suppresses nothing.
  kind            text NOT NULL,
  reason          text NOT NULL CHECK (length(btrim(reason)) > 0),
  snoozed_by      text NOT NULL,
  snoozed_at      timestamptz NOT NULL DEFAULT now(),
  suppressed_until timestamptz NOT NULL
);

-- One live snooze per customer per section. Re-snoozing replaces it rather
-- than stacking, so "how long has this been hidden" has one answer.
CREATE UNIQUE INDEX IF NOT EXISTS cs_focus_snoozes_live
  ON cs_focus_snoozes (customer_ns_id, kind);

CREATE INDEX IF NOT EXISTS cs_focus_snoozes_until
  ON cs_focus_snoozes (suppressed_until);

-- Reached only through the service-role client, so RLS would be decorative —
-- the same reasoning as every other cs_ table.
