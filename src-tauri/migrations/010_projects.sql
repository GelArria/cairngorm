-- Projects: a named folder that scopes terminals, files, git, calendar and chats.
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- NULL = created before projects existed; adopted by the first project.
ALTER TABLE calendar_events ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_calendar_events_project ON calendar_events(project_id);
