CREATE TABLE IF NOT EXISTS stripe_webhook_event (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  object_id TEXT,
  event_created INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS stripe_webhook_event_object_idx
  ON stripe_webhook_event(object_id, event_created);

CREATE TABLE IF NOT EXISTS stripe_webhook_cursor (
  object_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES stripe_webhook_event(id),
  event_type TEXT NOT NULL,
  event_created INTEGER NOT NULL,
  processed_at TEXT NOT NULL
);
