-- Add ticket linking and multi-day support to calendar_events
CREATE TABLE IF NOT EXISTS calendar_events_new (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    end_date TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    description TEXT NOT NULL DEFAULT '',
    ticket_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO calendar_events_new (
    id, title, date, end_date, start_time, end_time, color, description, ticket_id, created_at, updated_at
)
SELECT
    id, title, date, NULL, start_time, end_time, color, description, NULL, created_at, updated_at
FROM calendar_events;

DROP TABLE calendar_events;
ALTER TABLE calendar_events_new RENAME TO calendar_events;
