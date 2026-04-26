-- ─── Customer Portal Schema ────────────────────────────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- Required env vars to add:
--   SUPABASE_ANON_KEY (server-side portal API routes)
--   NEXT_PUBLIC_SUPABASE_URL (same value as SUPABASE_URL)
--   NEXT_PUBLIC_SUPABASE_ANON_KEY (same value as SUPABASE_ANON_KEY)

-- Maps Supabase auth users (customers) to their NetSuite customer account
CREATE TABLE IF NOT EXISTS customer_portal_users (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_ns_id text NOT NULL,
  customer_name  text NOT NULL,
  email          text NOT NULL,
  display_name   text,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_portal_users_ns_id ON customer_portal_users(customer_ns_id);

-- Which NS projects a customer can access
CREATE TABLE IF NOT EXISTS project_portal_access (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ns_id text NOT NULL,
  project_ns_id  text NOT NULL,
  project_name   text NOT NULL,
  invited_by     text NOT NULL,
  invited_at     timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_portal_access_uniq ON project_portal_access(customer_ns_id, project_ns_id);
CREATE INDEX IF NOT EXISTS project_portal_access_ns_id ON project_portal_access(customer_ns_id);

-- Task notes: staff and customer comments with visibility control
CREATE TABLE IF NOT EXISTS task_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_task_id  text NOT NULL,
  project_ns_id    text NOT NULL,
  body             text NOT NULL,
  is_internal      boolean NOT NULL DEFAULT false,
  author_name      text NOT NULL,
  author_type      text NOT NULL CHECK (author_type IN ('staff', 'customer')),
  customer_ns_id   text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_notes_task_id ON task_notes(clickup_task_id);
CREATE INDEX IF NOT EXISTS task_notes_project  ON task_notes(project_ns_id);

-- Task approvals / sign-offs by customers
CREATE TABLE IF NOT EXISTS task_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_task_id   text NOT NULL,
  project_ns_id     text NOT NULL,
  customer_ns_id    text NOT NULL,
  approved_by_name  text NOT NULL,
  approved_by_email text NOT NULL,
  notes             text,
  approved_at       timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_approvals_uniq ON task_approvals(clickup_task_id, customer_ns_id);
CREATE INDEX IF NOT EXISTS task_approvals_project ON task_approvals(project_ns_id);

-- Portal invitations (pending / accepted)
CREATE TABLE IF NOT EXISTS portal_invitations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  customer_ns_id text NOT NULL,
  customer_name  text NOT NULL,
  project_ns_ids text[] NOT NULL DEFAULT '{}',
  invited_by     text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at     timestamptz DEFAULT now(),
  accepted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS portal_invitations_email ON portal_invitations(email);

-- ─── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE customer_portal_users  ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_portal_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_notes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_invitations     ENABLE ROW LEVEL SECURITY;

-- customer_portal_users: own record only
CREATE POLICY "cpu_own_record" ON customer_portal_users
  FOR ALL USING (auth.uid() = id);

-- project_portal_access: own customer only
CREATE POLICY "ppa_own_customer" ON project_portal_access
  FOR SELECT USING (
    customer_ns_id = (
      SELECT customer_ns_id FROM customer_portal_users WHERE id = auth.uid()
    )
  );

-- task_notes: customers see non-internal notes on their projects
CREATE POLICY "tn_customer_read" ON task_notes
  FOR SELECT USING (
    is_internal = false
    AND project_ns_id IN (
      SELECT project_ns_id FROM project_portal_access
      WHERE customer_ns_id = (
        SELECT customer_ns_id FROM customer_portal_users WHERE id = auth.uid()
      )
    )
  );

-- task_notes: customers can insert non-internal notes on their projects
CREATE POLICY "tn_customer_insert" ON task_notes
  FOR INSERT WITH CHECK (
    is_internal = false
    AND author_type = 'customer'
    AND project_ns_id IN (
      SELECT project_ns_id FROM project_portal_access
      WHERE customer_ns_id = (
        SELECT customer_ns_id FROM customer_portal_users WHERE id = auth.uid()
      )
    )
  );

-- task_approvals: own customer only
CREATE POLICY "ta_own_customer" ON task_approvals
  FOR ALL USING (
    customer_ns_id = (
      SELECT customer_ns_id FROM customer_portal_users WHERE id = auth.uid()
    )
  );

-- portal_invitations: own email only
CREATE POLICY "pi_own_email" ON portal_invitations
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
