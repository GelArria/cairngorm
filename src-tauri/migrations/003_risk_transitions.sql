-- Risk transitions table for tracking risk level changes
CREATE TABLE IF NOT EXISTS risk_transitions (
    id TEXT PRIMARY KEY NOT NULL,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_level TEXT NOT NULL DEFAULT 'Green',
    to_level TEXT NOT NULL DEFAULT 'Green',
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for faster lookups by ticket
CREATE INDEX IF NOT EXISTS idx_risk_transitions_ticket_id ON risk_transitions(ticket_id);

-- Index for chronological ordering
CREATE INDEX IF NOT EXISTS idx_risk_transitions_created_at ON risk_transitions(created_at);
