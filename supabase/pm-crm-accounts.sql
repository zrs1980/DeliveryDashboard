-- ═══════════════════════════════════════════════════════════════════════════
-- Local accounts — prospects that do not exist in NetSuite yet
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run by hand in the Supabase SQL editor. Safe to re-run.
--
-- WHY
--
-- The account list is every active NetSuite record — 180 of them, including 90
-- prospects and 3 leads — so almost every real conversation already has an
-- account to hang off. The one thing it cannot do is start a deal against a
-- name NetSuite has never heard of, which is exactly the first five minutes of
-- a new opportunity.
--
-- ⚠ NETSUITE IS STILL THE CUSTOMER MASTER. These rows are a holding pen, not a
-- second master. They are visibly marked LOCAL everywhere they appear, and the
-- intended end state of every one of them is `linked_ns_id` being set — at
-- which point NetSuite owns the account and this row is only a record of where
-- it came from.
--
-- ⚠ THE JOIN KEY IS A SYNTHETIC `local:<uuid>` WRITTEN INTO `customer_ns_id`.
-- That is deliberate and it is why this feature costs one table instead of a
-- column on four. Every CRM table already keys on `customer_ns_id text` with no
-- foreign key, precisely because the master is elsewhere — so a prefixed id
-- slots into contacts, deals, tasks and activities with no schema change and no
-- query change anywhere.
--
-- The consequence to know: anything that takes a `customer_ns_id` and asks
-- NETSUITE about it will not find a local one. That is safe (it returns
-- nothing, it does not error) and it is correct — the account genuinely is not
-- there. It does mean the CS layer, health scoring and the Customers tab do not
-- see these rows at all, which is intended: there is nothing to score.

CREATE TABLE IF NOT EXISTS pm_crm_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  domain        text,
  website       text,
  phone         text,
  industry      text,
  -- Which book it belongs to, mirroring NetSuite's subsidiary. Nullable,
  -- because at this stage it is often genuinely not decided yet.
  subsidiary_id integer,
  stage         text NOT NULL DEFAULT 'PROSPECT'
                  CHECK (stage IN ('PROSPECT','LEAD')),
  notes         text,
  owner_email   text,

  -- Set when the account becomes real in NetSuite. A row with this set is
  -- retired: it no longer appears in the account list, and its CRM records have
  -- been re-keyed onto the NetSuite id.
  linked_ns_id  text,
  linked_at     timestamptz,
  linked_by     text,

  created_by    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- One live local account per name. Partial, so the name frees up once the row
-- is linked and retired — the real NetSuite account carries it from then on.
CREATE UNIQUE INDEX IF NOT EXISTS pm_crm_accounts_name_live
  ON pm_crm_accounts (lower(name)) WHERE linked_ns_id IS NULL;

CREATE INDEX IF NOT EXISTS pm_crm_accounts_live
  ON pm_crm_accounts (linked_ns_id, lower(name));

DROP TRIGGER IF EXISTS pm_crm_accounts_touch ON pm_crm_accounts;
CREATE TRIGGER pm_crm_accounts_touch BEFORE UPDATE ON pm_crm_accounts
  FOR EACH ROW EXECUTE FUNCTION cs_set_updated_at();

-- ─── Address, for parity with the NetSuite account page ────────────────────
-- Added September 2026 alongside the CRM account drill-down. A local prospect
-- shows the same key-information band as a NetSuite account, so it needs
-- somewhere to put an address.
--
-- ONE free-text block, not parsed columns, deliberately: NetSuite has no
-- address table in this account and BUILTIN.DF(defaultbillingaddress) returns
-- a formatted multi-line string, so parsed columns here would render
-- differently from every NetSuite account sitting beside it in the same list.
ALTER TABLE pm_crm_accounts ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE pm_crm_accounts ADD COLUMN IF NOT EXISTS email   text;
