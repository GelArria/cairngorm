-- Project tile background: "preset:<id>", "image:<path>" or "none" (NULL = app default preset).
ALTER TABLE projects ADD COLUMN background TEXT;
