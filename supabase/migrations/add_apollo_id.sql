ALTER TABLE contacts ADD COLUMN IF NOT EXISTS apollo_id text;
CREATE INDEX IF NOT EXISTS contacts_apollo_id_idx ON contacts (apollo_id) WHERE apollo_id IS NOT NULL;
