CREATE TABLE phone_challenges (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','sent','failed')),
  consumed_by TEXT,
  invalidated_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX phone_challenges_scope ON phone_challenges(shop_id,phone,created_at);
CREATE TRIGGER verification_cooldown BEFORE INSERT ON phone_challenges BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM phone_challenges WHERE shop_id=NEW.shop_id AND phone=NEW.phone AND created_at>unixepoch()-60
  ) THEN RAISE(ABORT,'VERIFICATION_COOLDOWN') END;
END;
CREATE TABLE customer_sessions (
  token_hash TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  phone TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX customer_sessions_expiry ON customer_sessions(expires_at);
CREATE TABLE verification_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK(attempts <= max_attempts)
);
CREATE INDEX customer_appointments ON appointments(shop_id,customer_phone,starts_at,id);
