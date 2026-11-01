-- Adds optional assignee field to kanban cards.
ALTER TABLE kanban_cards ADD COLUMN assigned_to TEXT;
