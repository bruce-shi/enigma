PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(user_id);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  issuer TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS subscription (
  id TEXT PRIMARY KEY NOT NULL,
  plan TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'incomplete',
  period_start TEXT,
  period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  seats INTEGER,
  trial_start TEXT,
  trial_end TEXT,
  cancel_at TEXT,
  canceled_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  billing_interval TEXT,
  stripe_schedule_id TEXT
);
CREATE INDEX IF NOT EXISTS subscription_reference_idx ON subscription(reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_stripe_id_idx ON subscription(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS desktop_auth_request (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  installation_public_key TEXT NOT NULL,
  computer_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('macos', 'windows')),
  channel TEXT NOT NULL CHECK(channel IN ('stable', 'beta')),
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  activation_id TEXT,
  authorization_code_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS desktop_auth_request_expiry_idx ON desktop_auth_request(expires_at);

CREATE TABLE IF NOT EXISTS desktop_activation (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  auth_request_id TEXT NOT NULL UNIQUE,
  slot INTEGER NOT NULL CHECK(slot IN (1, 2)),
  installation_public_key TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('macos', 'windows')),
  channel TEXT NOT NULL CHECK(channel IN ('stable', 'beta')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS desktop_activation_user_idx ON desktop_activation(user_id, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS desktop_activation_active_slot_idx
  ON desktop_activation(user_id, slot) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS desktop_refresh_token (
  id TEXT PRIMARY KEY NOT NULL,
  activation_id TEXT NOT NULL REFERENCES desktop_activation(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  authorization_request_id TEXT UNIQUE,
  rotated_from TEXT UNIQUE,
  revoked_at TEXT,
  rotated_to TEXT
);
CREATE INDEX IF NOT EXISTS desktop_refresh_activation_idx ON desktop_refresh_token(activation_id, revoked_at);
