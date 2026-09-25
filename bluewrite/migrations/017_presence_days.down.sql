-- 017 — reverse of 017_presence_days.sql.
--
-- WHAT THIS LOSES: every account's time-at-a-desk history. Nothing else in the
-- system reads it — the chathead rail is served by `users.last_seen_at`, which
-- 014 owns — so the only casualty is the account page's attendance sheet, which
-- falls back to estimating the whole year from the trail's own sign-ins (the same
-- reading it uses for the days before this table existed).

DROP TABLE IF EXISTS presence_days;
