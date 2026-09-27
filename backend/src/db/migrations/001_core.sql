-- 001: core tables: users, sessions, instagram_accounts, conversations, messages
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  rotated_from UUID REFERENCES sessions(id) ON DELETE SET NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'BUSINESS',
  access_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected',
  last_sync_at TIMESTAMPTZ,
  provider TEXT NOT NULL DEFAULT 'instagram',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ig_user_id)
);
CREATE INDEX idx_ig_accounts_user ON instagram_accounts(user_id);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_account_id UUID NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_conversation_id TEXT,
  participant_name TEXT NOT NULL,
  participant_avatar_url TEXT,
  is_known_contact BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  memory_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_reply_mode TEXT NOT NULL DEFAULT 'draft_only',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ig_account_id, external_conversation_id)
);
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_account ON conversations(ig_account_id, last_message_at DESC);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ig_message_id TEXT UNIQUE,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT,
  classification TEXT,
  sensitive BOOLEAN NOT NULL DEFAULT false,
  sent_via TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
