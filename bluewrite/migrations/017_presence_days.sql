-- 017 — presence_days: how long each account was actually at a desk, per day.
--
-- WHY THIS TABLE EXISTS. The station asked its account page for an attendance
-- sheet — one square per day, deeper the longer the officer was there — and the
-- audit trail cannot answer that. The trail records when somebody SIGNS IN and
-- when they press SIGN OUT; closing the tab, walking away and letting the session
-- time out, or shutting the PC down all leave no end mark at all, so a year of
-- the trail gives a handful of exact session lengths and a pile of unknown ones.
--
-- The one signal that IS continuous already exists: the workspace heartbeats every
-- thirty seconds while it is open (`PresenceController::heartbeat`, which is what
-- puts a face on the chathead rail). Until now that beat only wrote
-- `users.last_seen_at` — a single stamp, overwritten each time, which answers
-- "are they here NOW" and nothing about yesterday. This table is the same beat
-- kept as a history.
--
-- WHAT IT MEASURES, precisely. Not "first beat to last beat" — that would call an
-- eight-hour day with a three-hour lunch a full eight hours, since `last_seen`
-- keeps moving across the gap. `seconds` is the sum of the gaps BETWEEN
-- CONSECUTIVE beats that are close enough together to be one sitting, so an
-- officer who signs out for lunch and comes back is credited with the two
-- sittings and not the interval between them. The threshold is the same window
-- the rail uses to decide somebody is still online (ONLINE_WINDOW_SECONDS), which
-- is why a closed laptop lid ends the sitting and a slow minute does not.
--
-- first_seen / last_seen are kept BESIDE the sum rather than instead of it: they
-- are what the sheet says on hover ("08:02 – 17:11, 6h 40m at the desk"), and a
-- span and a sum are two facts about a day, not two versions of one.
--
-- IT STARTS EMPTY, AND THAT IS HONEST. The beats were never recorded before this
-- migration, so there is nothing to backfill. The account page reads the days
-- before it from the trail's own sign-ins — an estimate, marked as one — and the
-- days from it onwards from here.

CREATE TABLE IF NOT EXISTS presence_days (
  user_id INT UNSIGNED NOT NULL,
  -- The station's own calendar day, from the same clock the beats are stamped
  -- with, so a night shift is attributed to the date the server was on.
  day DATE NOT NULL,
  first_seen DATETIME NOT NULL,
  last_seen DATETIME NOT NULL,
  -- Time at the desk, in seconds: consecutive beats merged, gaps excluded.
  seconds INT UNSIGNED NOT NULL DEFAULT 0,
  -- How many beats landed in this day, kept because a day with ONE beat is a
  -- day somebody was there and would otherwise read as zero seconds.
  beats INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  -- The sheet reads one account's year, and this index is that read.
  KEY idx_presence_day (day),
  CONSTRAINT fk_presence_days_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
