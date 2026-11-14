CREATE TABLE whatsapp_deliveries (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  dedupe_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('access_code','confirmation','reschedule','cancellation','reminder','test')),
  appointment_id TEXT,
  booking_version INTEGER,
  challenge_id TEXT,
  recipient TEXT NOT NULL,
  payload TEXT,
  iv TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','accepted','sent','delivered','read','retry','failed','unknown','suppressed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT(unixepoch()),
  expires_at INTEGER NOT NULL,
  claim_token TEXT,
  lease_expires_at INTEGER,
  provider_id TEXT UNIQUE,
  last_error_code TEXT,
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(shop_id,dedupe_key),
  FOREIGN KEY(shop_id,appointment_id) REFERENCES appointments(shop_id,id)
);
CREATE INDEX whatsapp_due ON whatsapp_deliveries(shop_id,state,next_attempt_at);
CREATE TABLE whatsapp_attempts (
  token TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES whatsapp_deliveries(id),
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('started','accepted','rejected','unknown','sent','delivered','read','failed')),
  provider_id TEXT UNIQUE,
  error_code TEXT,
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(delivery_id,attempt)
);
CREATE TABLE whatsapp_processed_events (
  outbox_id INTEGER PRIMARY KEY REFERENCES notification_outbox(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('queued','obsolete','outside_test','before_activation')),
  processed_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE whatsapp_retry_requests (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  request_key TEXT NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES whatsapp_deliveries(id),
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  PRIMARY KEY(shop_id,request_key)
);
CREATE TABLE whatsapp_webhook_events (
  event_key TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES whatsapp_deliveries(id),
  status TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT(unixepoch())
);
-- Uma alteração da reserva não pode ultrapassar o envio que já começou.
-- O envio tem timeout de 8s; o lease de 45s cobre a persistência do resultado.
CREATE TRIGGER whatsapp_booking_send_guard BEFORE UPDATE OF starts_at,ends_at,status ON appointments
WHEN EXISTS (SELECT 1 FROM whatsapp_deliveries WHERE shop_id=OLD.shop_id AND appointment_id=OLD.id AND state='sending' AND lease_expires_at>unixepoch()) BEGIN
  SELECT RAISE(ABORT,'WHATSAPP_SEND_IN_PROGRESS');
END;
CREATE TRIGGER whatsapp_superseded AFTER UPDATE OF starts_at,ends_at,status ON appointments BEGIN
  UPDATE whatsapp_deliveries SET state='suppressed',payload=NULL,iv=NULL,updated_at=unixepoch()
  WHERE shop_id=NEW.shop_id AND appointment_id=NEW.id AND booking_version<>NEW.version AND state IN ('queued','retry');
END;
