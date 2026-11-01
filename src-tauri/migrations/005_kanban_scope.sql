-- Adds scope separation to kanban columns (personal/team/project/company).
-- SQLite does not support ADD COLUMN IF NOT EXISTS, so this migration relies
-- on plugin-sql version tracking to run exactly once (version 5).
ALTER TABLE kanban_columns ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal';

-- Index for fast scope lookups when loading a board
CREATE INDEX IF NOT EXISTS idx_kanban_columns_scope ON kanban_columns(scope);
