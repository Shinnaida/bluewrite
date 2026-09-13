-- BlueWrite migration 003: Phase 3 AI narrative assistant.
-- ai_requests  — one row per generation attempt-cycle (§7). Holds status and
--                the payload HASH only: the masked payload itself is
--                recomputed from the report at retry time, so no
--                sensitive-adjacent copy is persisted.
-- ai_cache     — short-TTL response cache keyed by masked-payload hash (§8).
--                Absorbs double-clicks; the payload stored here is already
--                fully UNMASKED output (the officer's own draft), so the
--                cache never holds the identity map.

CREATE TABLE IF NOT EXISTS ai_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id INT UNSIGNED NOT NULL,
  masked_payload_hash CHAR(64) NOT NULL,
  status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ai_requests_report (report_id),
  INDEX idx_ai_requests_hash (masked_payload_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_cache (
  payload_hash CHAR(64) PRIMARY KEY,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
