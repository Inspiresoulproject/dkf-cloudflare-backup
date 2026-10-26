-- Existing pending_verifications table is retained; add state tracking for safe, atomic claims.
ALTER TABLE pending_verifications ADD COLUMN state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE pending_verifications ADD COLUMN processing_since INTEGER;
ALTER TABLE pending_verifications ADD COLUMN resend_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pending_state ON pending_verifications(state, expires_at);
CREATE TABLE IF NOT EXISTS submission_rate_limits (
  id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (id, window_start)
);
-- Apply once only, to the existing D1 database. See README.
