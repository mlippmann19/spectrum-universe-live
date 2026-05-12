-- ERP Production Board migration
-- Adds columns to installation_jobs and installation_checklist_items to back
-- the Pipeline + Shop Floor views. Uses IF NOT EXISTS so existing fields
-- (job_no, stage, customer_name, etc.) are preserved.

ALTER TABLE installation_jobs
  ADD COLUMN IF NOT EXISTS wo_number TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'sleeve',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_production',
  ADD COLUMN IF NOT EXISTS is_new_order BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer TEXT,
  ADD COLUMN IF NOT EXISTS state_code TEXT,
  ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS diameter_in NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS face_length_in NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS position_type TEXT,
  ADD COLUMN IF NOT EXISTS rep_code TEXT,
  ADD COLUMN IF NOT EXISTS product_code TEXT,
  ADD COLUMN IF NOT EXISTS thickness NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cogs NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS date_received DATE,
  ADD COLUMN IF NOT EXISTS promised_ship_date DATE,
  ADD COLUMN IF NOT EXISTS ship_date_type TEXT DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS ship_date_offset_days INTEGER,
  ADD COLUMN IF NOT EXISTS actual_ship_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_month INTEGER,
  ADD COLUMN IF NOT EXISTS week_of DATE;

-- wo_number must be unique so seed re-runs use ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS installation_jobs_wo_number_key
  ON installation_jobs (wo_number)
  WHERE wo_number IS NOT NULL;

-- installation_checklist_items already has job_id (uuid), sort_order, notes.
-- Add the production-board specific fields.
ALTER TABLE installation_checklist_items
  ADD COLUMN IF NOT EXISTS operation TEXT,
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS quantity_required INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_completed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_complete BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_by TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q_per_shift NUMERIC(5,2);

-- One row per (job, operation) so re-seeding is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS installation_checklist_items_job_op_key
  ON installation_checklist_items (job_id, operation)
  WHERE operation IS NOT NULL;
