PRAGMA foreign_keys = ON;

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('link', 'hub')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  price_label TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (20,30,40,60)),
  starts_at INTEGER NOT NULL CHECK (starts_at % 600 = 0),
  ends_at INTEGER NOT NULL CHECK (ends_at = starts_at + duration_minutes * 60),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX appointments_start ON appointments(starts_at);

-- A única inserção cria os segmentos dentro da mesma transação SQLite/D1.
-- Qualquer colisão na chave primária desfaz a reserva inteira (inclusive seus segmentos).
CREATE TABLE occupied_segments (
  starts_at INTEGER PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE
);
CREATE TRIGGER reserve_segments AFTER INSERT ON appointments BEGIN
  INSERT INTO occupied_segments (starts_at, appointment_id)
  SELECT NEW.starts_at + CAST(value AS INTEGER) * 600, NEW.id
  FROM json_each('[0,1,2,3,4,5]')
  WHERE CAST(value AS INTEGER) < NEW.duration_minutes / 10;
END;

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
