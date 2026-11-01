-- Remove the tickets, risk, plan-mode and kanban modules (children first: FKs).
DROP TABLE IF EXISTS plan_mode_contexts;
DROP TABLE IF EXISTS agent_failed_attempts;
DROP TABLE IF EXISTS risk_transitions;
DROP TABLE IF EXISTS collaboration_messages;
DROP TABLE IF EXISTS evidence_packages;
DROP TABLE IF EXISTS agent_actions;
DROP TABLE IF EXISTS ticket_state_transitions;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS kanban_cards;
DROP TABLE IF EXISTS kanban_columns;
-- Events that only existed to point at a ticket go with the tickets.
DELETE FROM calendar_events WHERE ticket_id IS NOT NULL;
ALTER TABLE calendar_events DROP COLUMN ticket_id;
