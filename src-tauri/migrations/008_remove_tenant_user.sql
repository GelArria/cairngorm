-- Remove multi-tenant and user-account schema (single-user tool).
DELETE FROM kanban_columns WHERE scope != 'personal';
-- 005 indexed scope: the index must go first or DROP COLUMN fails (and the whole migration with it).
DROP INDEX IF EXISTS idx_kanban_columns_scope;
ALTER TABLE kanban_columns DROP COLUMN scope;
ALTER TABLE kanban_cards DROP COLUMN assigned_to;
ALTER TABLE tickets DROP COLUMN employee_id;
ALTER TABLE tickets DROP COLUMN company;
DROP TABLE IF EXISTS profile;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS projects;
UPDATE kanban_columns SET title = 'Pending' WHERE title = 'Pendiente';
UPDATE kanban_columns SET title = 'To Do' WHERE title = 'Por Hacer';
UPDATE kanban_columns SET title = 'In Progress' WHERE title = 'En Progreso';
UPDATE kanban_columns SET title = 'Review' WHERE title = 'Revisión';
UPDATE kanban_columns SET title = 'Done' WHERE title = 'Listo';