-- 0005 está reservado à integração WhatsApp do PR separado. Esta etapa não a ativa.
CREATE TABLE booking_link_keys (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id),
  secret TEXT NOT NULL
);
CREATE TABLE booking_links (
  shop_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  PRIMARY KEY(shop_id,appointment_id),
  FOREIGN KEY(shop_id,appointment_id) REFERENCES appointments(shop_id,id)
);
CREATE TABLE booking_link_sessions (
  token_hash TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(shop_id,appointment_id) REFERENCES booking_links(shop_id,appointment_id)
);
CREATE INDEX booking_link_sessions_scope ON booking_link_sessions(shop_id,appointment_id,expires_at);
