-- Reverse of 021_retire_staff_role.sql: restore the Staff role row.
-- Converted accounts are NOT moved back — the up migration does not record
-- which rows were Staff, so a downgrade restores the role, not its holders.
-- Reassigning accounts back to Staff, if ever wanted, is a manual UPDATE.

INSERT IGNORE INTO roles (id, name) VALUES (3, 'Staff');
