-- User-level automation settings (turbo mode).
-- turbo_mode ON means: generated replies on 'automatic' conversations (and
-- on-demand generations) are sent WITHOUT prior approval. Sensitive content
-- and unknown-fact cases are STILL held as drafts (hard guardrail).
CREATE TABLE IF NOT EXISTS user_automation_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  turbo_mode BOOLEAN NOT NULL DEFAULT FALSE,
  turbo_acknowledged_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
