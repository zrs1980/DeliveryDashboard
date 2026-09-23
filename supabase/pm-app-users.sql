-- ═══════════════════════════════════════════════════════════════════════════
-- pm_app_users — who actually has a login to this tool
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor. Safe to re-run.
--
-- WHY THIS AND NOT THE NETSUITE ROSTER
--
-- `lib/roster.ts` answers "who works here". That is NOT the same question as
-- "who can be assigned a task in this app", and the gap runs both ways:
--
--   · getConsultantRoster() is custentity10 IN (1,2) — Consulting and PMO only.
--     It excludes Sales, Back Office, Management and Product, all of whom have
--     logins and all of whom get asked to do things.
--   · Sign-in is Google OAuth restricted by AUTH_ALLOWED_DOMAIN, so the real
--     gate is a domain, not a NetSuite category.
--   · Someone can hold a NetSuite employee record and have never signed in.
--
-- So this table records what actually happened: a row is written the first time
-- someone completes sign-in, and touched on every sign-in after. It is the
-- authoritative answer to "has a login", and `/api/users` merges it with the
-- active NetSuite roster so a colleague who has not signed in yet is still
-- assignable — visibly marked as not having signed in.
--
-- ⚠ NOT A PERMISSION TABLE. Presence here means "this person has logged in",
-- nothing more. Authorisation still lives where it lived: AUTH_ALLOWED_DOMAIN
-- for sign-in, `lib/cs-permissions.ts` for the CS layer. Do not start reading
-- this table to decide what someone may do.

CREATE TABLE IF NOT EXISTS pm_app_users (
  email         text PRIMARY KEY,
  name          text,
  image_url     text,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at  timestamptz DEFAULT now(),
  -- Set false to retire someone from assignee pickers without deleting the row,
  -- so their name still resolves on tasks they were assigned in the past.
  is_active     boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS pm_app_users_active ON pm_app_users (is_active, lower(name));

-- ─── Backfill from google_tokens ───────────────────────────────────────────
-- Every completed sign-in has already written a row there, so the list is
-- populated from day one rather than starting empty and filling up only as
-- people happen to sign in again.
--
-- Name is left NULL here deliberately: google_tokens holds no name, and
-- /api/users resolves it from the NetSuite roster by email. Inventing one from
-- the email local-part would produce "zabe" where the roster has the real name.
INSERT INTO pm_app_users (email, first_seen_at, last_seen_at)
SELECT DISTINCT lower(user_email), COALESCE(updated_at, now()), COALESCE(updated_at, now())
FROM google_tokens
WHERE user_email IS NOT NULL
ON CONFLICT (email) DO NOTHING;
