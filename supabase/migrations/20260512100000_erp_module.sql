-- ERP Module Schema
-- Adds tube_inventory columns and creates 6 new tables for work orders / jobs / tasks / actuals / woodshop / time entries.

CREATE TABLE IF NOT EXISTS tube_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tube_number text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tube_inventory
  ADD COLUMN IF NOT EXISTS initial_diameter numeric(8,4),
  ADD COLUMN IF NOT EXISTS expanded_diameter numeric(8,4),
  ADD COLUMN IF NOT EXISTS current_length numeric(8,3),
  ADD COLUMN IF NOT EXISTS qr_code_id text,
  ADD COLUMN IF NOT EXISTS material_type text,
  ADD COLUMN IF NOT EXISTS vendor text DEFAULT 'Saint Gobain',
  ADD COLUMN IF NOT EXISTS received_date date,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS previously_etched boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_per_linear_foot numeric(8,4),
  ADD COLUMN IF NOT EXISTS availability text DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS order_status text;

CREATE TABLE IF NOT EXISTS work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_number text UNIQUE NOT NULL,
  quote_id uuid,
  customer_id uuid,
  customer_name text NOT NULL,
  po_number text,
  country_location text DEFAULT 'us_canada',
  special_instructions text,
  scheduled_ship_date date,
  carrier text,
  tracking_number text,
  additional_pkg text DEFAULT 'none',
  filters text,
  install boolean DEFAULT false,
  payment_type text DEFAULT 'collect',
  freight_charges numeric(10,2),
  status text DEFAULT 'open',
  total_value numeric(10,2),
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erp_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number text UNIQUE NOT NULL,
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  job_index integer NOT NULL DEFAULT 1,
  roll_diameter numeric(8,4) NOT NULL,
  roll_length numeric(8,3) NOT NULL,
  material_type text NOT NULL,
  roll_type text,
  job_type text DEFAULT 'expansion',
  etching_required boolean DEFAULT false,
  quantity integer DEFAULT 1,
  status text DEFAULT 'current',
  inventory_id uuid,
  qa_qc_pending boolean DEFAULT false,
  sleeve_diameter numeric(8,4),
  cut_width numeric(8,4),
  cut_length numeric(8,3),
  bag_lay_flat numeric(8,4),
  minimum_diameter numeric(8,4),
  minimum_width numeric(8,4),
  tube_length numeric(8,3),
  tube_qty integer,
  tube_diameter numeric(8,4),
  roll_circumference numeric(8,4),
  min_circumference numeric(8,4),
  max_circumference numeric(8,4),
  sleeve_length numeric(8,3),
  wooden_end_caps boolean DEFAULT false,
  adhesive_type text DEFAULT '2009',
  adhesive_vol_part_a numeric(8,4),
  adhesive_vol_part_b numeric(8,4),
  add_adhesive_vol_part_a numeric(8,4),
  add_adhesive_vol_part_b numeric(8,4),
  tube_weight numeric(8,4),
  serial_numbers text,
  pct_complete numeric(5,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES erp_jobs(id) ON DELETE CASCADE,
  phase text NOT NULL,
  task_sequence integer NOT NULL,
  task_name text NOT NULL,
  has_photo boolean DEFAULT false,
  is_done boolean DEFAULT false,
  done_by uuid,
  done_at timestamptz,
  photo_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expansion_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES erp_jobs(id) ON DELETE CASCADE,
  expansion_method text,
  target_roll_circ numeric(8,4),
  target_min_circ numeric(8,4),
  target_max_circ numeric(8,4),
  target_sleeve_length numeric(8,3),
  hot_target_circ numeric(8,4),
  hot_temp_over_215 boolean,
  hot_steam_psi numeric(8,2),
  hot_avg_steam_psi numeric(8,2),
  hot_steam_circ numeric(8,4),
  hot_air_cool_psi numeric(8,2),
  cool_steam_end_circ numeric(8,4),
  cool_middle_circ numeric(8,4),
  cool_drain_end_circ numeric(8,4),
  cool_actual_sleeve_length numeric(8,3),
  cool_usable_length numeric(8,3),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS woodshop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  job_id uuid REFERENCES erp_jobs(id),
  item_type text NOT NULL,
  status text DEFAULT 'pending',
  actual_length numeric(8,3),
  actual_width numeric(8,3),
  actual_height numeric(8,3),
  lumber_2x4_qty integer,
  calc_length numeric(8,3),
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES erp_jobs(id),
  work_order_id uuid REFERENCES work_orders(id),
  user_id uuid NOT NULL,
  phase text,
  clocked_in_at timestamptz NOT NULL DEFAULT now(),
  clocked_out_at timestamptz,
  duration_minutes integer,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE expansion_actuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE woodshop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tube_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_work_orders" ON work_orders;
CREATE POLICY "anon_all_work_orders" ON work_orders FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_all_erp_jobs" ON erp_jobs;
CREATE POLICY "anon_all_erp_jobs" ON erp_jobs FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_all_job_tasks" ON job_tasks;
CREATE POLICY "anon_all_job_tasks" ON job_tasks FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_all_expansion_actuals" ON expansion_actuals;
CREATE POLICY "anon_all_expansion_actuals" ON expansion_actuals FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_all_woodshop_items" ON woodshop_items;
CREATE POLICY "anon_all_woodshop_items" ON woodshop_items FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_all_time_entries" ON time_entries;
CREATE POLICY "anon_all_time_entries" ON time_entries FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_all_tube_inventory" ON tube_inventory;
CREATE POLICY "anon_all_tube_inventory" ON tube_inventory FOR ALL USING (true) WITH CHECK (true);
