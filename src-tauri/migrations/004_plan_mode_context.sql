-- Plan Mode conversation context storage
-- Links tickets to their originating Plan Mode conversations
CREATE TABLE IF NOT EXISTS plan_mode_contexts (
    id TEXT PRIMARY KEY NOT NULL,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    exchanges_json TEXT NOT NULL DEFAULT '[]',
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for ticket lookups
CREATE INDEX IF NOT EXISTS idx_plan_mode_contexts_ticket_id ON plan_mode_contexts(ticket_id);

-- Failed agent attempts tracking for Fail Safe
CREATE TABLE IF NOT EXISTS agent_failed_attempts (
    id TEXT PRIMARY KEY NOT NULL,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    error_description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_failed_attempts_ticket_id ON agent_failed_attempts(ticket_id);
