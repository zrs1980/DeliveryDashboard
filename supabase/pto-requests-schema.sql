-- Run this in the Supabase SQL editor to create the PTO requests table

CREATE TABLE IF NOT EXISTS pto_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_email   TEXT NOT NULL,
  employee_name    TEXT NOT NULL,
  employee_ns_id   INTEGER,
  type             TEXT NOT NULL CHECK (type IN ('pto', 'sick')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  hours            NUMERIC(6, 2) NOT NULL,
  reason           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_notes   TEXT,
  approval_token   UUID NOT NULL DEFAULT gen_random_uuid(),
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      TEXT
);

CREATE INDEX IF NOT EXISTS pto_requests_email_idx  ON pto_requests (employee_email);
CREATE INDEX IF NOT EXISTS pto_requests_status_idx ON pto_requests (status);
