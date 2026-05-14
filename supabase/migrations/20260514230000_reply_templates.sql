-- ============================================================
-- Spectrum CRM — Reply Templates Table (source PR #16)
--
-- Persists the Web Inquiries smart-reply template catalog so admins
-- can tune copy from the Reply Templates page without shipping a
-- code change. The smart-reply engine falls back to the in-code
-- REPLY_TEMPLATES defaults whenever no row exists for a given
-- (division, mode) — so this migration is safe to run before any
-- rows are seeded.
--
-- Originally added in apps/spectrum-crm/supabase-migration-reply-templates.sql
-- in source repo PR #16 (b6323aa). Mirrored here under the live repo's
-- timestamped supabase/migrations convention.
-- ============================================================

CREATE TABLE IF NOT EXISTS reply_templates (
  id          TEXT        PRIMARY KEY,                   -- e.g. fluoron_incomplete
  division    TEXT        NOT NULL,                      -- fluoron | aegis | radiant | unknown
  mode        TEXT        NOT NULL,                      -- incomplete | complete
  subject     TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  signature   TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reply_templates_division_mode_unique UNIQUE (division, mode)
);

-- Optional index for "list by division" lookups.
CREATE INDEX IF NOT EXISTS reply_templates_division_idx
  ON reply_templates (division, mode);
