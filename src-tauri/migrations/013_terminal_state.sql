CREATE TABLE IF NOT EXISTS terminal_state (
  key TEXT PRIMARY KEY NOT NULL CHECK(length(key) <= 256),
  value TEXT CHECK(value IS NULL OR length(value) <= 16777216),
  updated_at INTEGER NOT NULL
);
