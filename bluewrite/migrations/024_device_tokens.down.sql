-- Rollback for migration 024: every phone signed in through a device token
-- stops working and must be set up again.

DROP TABLE IF EXISTS device_tokens;
