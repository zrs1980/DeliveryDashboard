-- ============================================================
-- CEBA Company Wiki — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Categories (create before wiki_pages due to FK dependency)
CREATE TABLE IF NOT EXISTS wiki_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  parent_id  INTEGER REFERENCES wiki_categories(id) ON DELETE SET NULL,
  icon       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pages
CREATE TABLE IF NOT EXISTS wiki_pages (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  body        TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES wiki_categories(id) ON DELETE SET NULL,
  author      TEXT NOT NULL DEFAULT 'CEBA Staff',
  is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  -- Full-text search column (PostgreSQL 12+)
  fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(body,  '') || ' ' ||
      coalesce(author,'')
    )
  ) STORED
);

CREATE INDEX IF NOT EXISTS wiki_pages_fts_idx    ON wiki_pages USING GIN (fts);
CREATE INDEX IF NOT EXISTS wiki_pages_cat_idx    ON wiki_pages (category_id);
CREATE INDEX IF NOT EXISTS wiki_pages_pinned_idx ON wiki_pages (is_pinned);
CREATE INDEX IF NOT EXISTS wiki_pages_updated_idx ON wiki_pages (updated_at DESC);

-- Auto-update updated_at on every edit
CREATE OR REPLACE FUNCTION wiki_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wiki_pages_updated_at ON wiki_pages;
CREATE TRIGGER wiki_pages_updated_at
  BEFORE UPDATE ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION wiki_set_updated_at();

-- ── Seed categories ──────────────────────────────────────────
INSERT INTO wiki_categories (name, slug, parent_id, icon) VALUES
  ('Delivery',          'delivery',       NULL, '🚀'),
  ('Operations',        'operations',     NULL, '⚙️'),
  ('Sales',             'sales',          NULL, '💼'),
  ('Finance',           'finance',        NULL, '💰'),
  ('Leadership',        'leadership',     NULL, '🎯')
ON CONFLICT (slug) DO NOTHING;

-- Sub-categories (look up parent IDs by slug)
INSERT INTO wiki_categories (name, slug, parent_id, icon)
SELECT 'Onboarding',        'onboarding',          id, '👋' FROM wiki_categories WHERE slug = 'delivery'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO wiki_categories (name, slug, parent_id, icon)
SELECT 'Project Execution', 'project-execution',   id, '📋' FROM wiki_categories WHERE slug = 'delivery'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO wiki_categories (name, slug, parent_id, icon)
SELECT 'Go-Live',           'go-live',             id, '🚀' FROM wiki_categories WHERE slug = 'delivery'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO wiki_categories (name, slug, parent_id, icon)
SELECT 'HR',                'hr',                  id, '👥' FROM wiki_categories WHERE slug = 'operations'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO wiki_categories (name, slug, parent_id, icon)
SELECT 'Billing',           'billing',             id, '🧾' FROM wiki_categories WHERE slug = 'operations'
ON CONFLICT (slug) DO NOTHING;

-- ── Seed sample pages ─────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned)
SELECT
  'New Hire Onboarding',
  'new-hire-onboarding',
  E'# New Hire Onboarding\n\nWelcome to CEBA Solutions! This guide covers everything you need to get up and running.\n\n## Week 1 Checklist\n\n- Set up your CEBA email and Slack\n- Get access to NetSuite (contact Kathy Bacero)\n- Get access to ClickUp (contact your PM)\n- Join relevant project channels in Slack\n- Review CEBA Delivery Methodology\n\n## Tools You Will Use\n\n**NetSuite** — ERP platform we implement for clients. You will need a CEBA employee license.\n\n**ClickUp** — Project and task management. All client work is tracked here.\n\n**Google Workspace** — Email, calendar, and docs.\n\n## Who to Contact\n\n- **Payroll / HR** — Kathy Bacero\n- **NetSuite Access** — Kathy Bacero\n- **ClickUp Access** — Your assigned PM\n- **IT / Laptop setup** — Kathy Bacero\n\n## First Week Goals\n\n1. Shadow your assigned PM on a client call\n2. Complete the NetSuite Fundamentals course\n3. Read the CEBA Delivery Methodology doc\n4. Set up your dev/sandbox NS environment',
  (SELECT id FROM wiki_categories WHERE slug = 'onboarding'),
  'Kathy Bacero',
  TRUE
ON CONFLICT (slug) DO NOTHING;

INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned)
SELECT
  'Project Kickoff Checklist',
  'project-kickoff-checklist',
  E'# Project Kickoff Checklist\n\nUse this checklist for every new NetSuite implementation project before the first client call.\n\n## Pre-Kickoff (Internal)\n\n- Review the signed SOW and project scope\n- Create the project in NetSuite (entitystatus = 2)\n- Set `custentity_project_golive_date` — mandatory\n- Set `custentity_ceba_project_budget_hours`\n- Create the ClickUp project space/list\n- Add `custentity20` (ClickUp URL) to the NS project record\n- Assign PMs and consultants in both NS and ClickUp\n- Schedule kickoff call with client\n\n## Kickoff Call Agenda\n\n1. Introductions (15 min)\n2. Project scope review (20 min)\n3. Timeline walkthrough — 5-phase structure (15 min)\n4. Communication plan — cadence, channels (10 min)\n5. Q&A (10 min)\n\n## Post-Kickoff\n\n- Send meeting notes within 24 hours\n- Create Phase 1 tasks in ClickUp\n- Book weekly check-in recurring call\n- Share client portal login (if applicable)\n\n## The 5-Phase Structure\n\n1. **Phase 1** — Planning & Design\n2. **Phase 2** — Configuration & Testing\n3. **Phase 3** — Training & UAT\n4. **Phase 4** — Readiness\n5. **Phase 5** — Go Live & Hypercare',
  (SELECT id FROM wiki_categories WHERE slug = 'project-execution'),
  'Shai Aradais',
  TRUE
ON CONFLICT (slug) DO NOTHING;

INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned)
SELECT
  'Go-Live Readiness Checklist',
  'go-live-readiness',
  E'# Go-Live Readiness Checklist\n\nComplete all items before confirming a go-live date with the client.\n\n## Technical Readiness\n\n- All Phase 1–4 tasks marked Done in ClickUp\n- UAT sign-off received from client (written confirmation)\n- Data migration validated — record counts match source system\n- All custom scripts tested in production\n- Saved searches and reports verified\n- User roles and permissions confirmed\n- Opening balances entered and reconciled\n\n## Training Readiness\n\n- All end users trained (attendance logged)\n- Training materials delivered to client\n- Quick reference guides distributed\n- Client confirms readiness to go live\n\n## Go-Live Day\n\n- Confirm go-live window with client (recommend Tuesday–Thursday)\n- CEBA consultant on standby for full first day\n- NetSuite support case open (if complex cutover)\n- Rollback plan documented\n\n## Post Go-Live (Hypercare)\n\n- Daily check-in call for first 5 business days\n- Track all issues in ClickUp as blocked/priority tasks\n- Budget 10–20 hours hypercare time\n- Formal project close when no open P1/P2 issues\n\n> **Important:** Never confirm a go-live date until UAT sign-off is received in writing.',
  (SELECT id FROM wiki_categories WHERE slug = 'go-live'),
  'Alecia Gilmore',
  FALSE
ON CONFLICT (slug) DO NOTHING;
