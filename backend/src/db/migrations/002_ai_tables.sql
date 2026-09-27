-- 002: AI/tone tables: tone_profiles, style_examples, conversation_memories,
-- generation_history, automation_rules, notification_preferences, usage_records, audit_events
CREATE TABLE tone_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ig_account_id UUID REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  avg_message_length INTEGER NOT NULL DEFAULT 24,
  formality INTEGER NOT NULL DEFAULT 20,
  emoji_frequency REAL NOT NULL DEFAULT 0.1,
  preferred_emojis TEXT[] NOT NULL DEFAULT '{}',
  common_slang TEXT[] NOT NULL DEFAULT '{}',
  common_phrases TEXT[] NOT NULL DEFAULT '{}',
  punctuation_style TEXT NOT NULL DEFAULT 'minimal',
  capitalization TEXT NOT NULL DEFAULT 'lowercase',
  humor_level INTEGER NOT NULL DEFAULT 40,
  languages TEXT[] NOT NULL DEFAULT '{english}',
  hinglish_usage REAL NOT NULL DEFAULT 0,
  asks_followups BOOLEAN NOT NULL DEFAULT true,
  mirrors_tone BOOLEAN NOT NULL DEFAULT true,
  learning_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE style_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_account_id UUID REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  category TEXT,
  language TEXT NOT NULL DEFAULT 'english',
  tone TEXT,
  situation TEXT,
  embedding JSONB,
  source TEXT NOT NULL DEFAULT 'manual',
  source_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_style_examples_user ON style_examples(user_id, created_at DESC);

CREATE TABLE conversation_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  important_facts TEXT[] NOT NULL DEFAULT '{}',
  unanswered_questions TEXT[] NOT NULL DEFAULT '{}',
  language TEXT,
  tone_context TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)
);
CREATE INDEX idx_memories_user ON conversation_memories(user_id);

CREATE TABLE generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  reply_text TEXT NOT NULL,
  reply_mode TEXT NOT NULL DEFAULT 'normal',
  custom_instruction TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  accepted BOOLEAN,
  edited BOOLEAN,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_generation_history_user ON generation_history(user_id, created_at DESC);

CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_account_id UUID REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_rules_user ON automation_rules(user_id);

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'ai_drafts_only',
  new_dm_enabled BOOLEAN NOT NULL DEFAULT true,
  fcm_token TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  generations INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_events_user ON audit_events(user_id, created_at DESC);
