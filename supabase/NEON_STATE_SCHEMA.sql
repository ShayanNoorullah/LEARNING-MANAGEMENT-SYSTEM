-- Optional Neon state store used by the EAD backend.
CREATE TABLE IF NOT EXISTS ead_portal_state (
  id TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
