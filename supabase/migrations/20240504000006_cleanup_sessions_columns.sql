-- Cleanup: Remove redundant columns from sessions table
-- These are now handled in the specialized owner_sessions table.

ALTER TABLE sessions DROP COLUMN IF EXISTS format_type;
ALTER TABLE sessions DROP COLUMN IF EXISTS sub_courts_used;

-- Also remove the index associated with format_type if it exists
DROP INDEX IF EXISTS idx_sessions_format_type;
