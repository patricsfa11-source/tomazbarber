-- Concluir o atendimento não registra dinheiro nem altera a reserva para cancelada.
ALTER TABLE appointments ADD COLUMN completed_at INTEGER;
ALTER TABLE appointments ADD COLUMN completion_key TEXT;
CREATE UNIQUE INDEX appointment_completion_key ON appointments(shop_id,completion_key);
CREATE TRIGGER completion_guard BEFORE UPDATE OF completed_at ON appointments WHEN NEW.completed_at IS NOT NULL BEGIN
  SELECT CASE WHEN OLD.status<>'confirmed' OR OLD.completed_at IS NOT NULL OR OLD.starts_at>unixepoch()
    THEN RAISE(ABORT,'CANNOT_COMPLETE') END;
END;
CREATE TRIGGER completed_booking_guard BEFORE UPDATE OF starts_at,ends_at,status ON appointments WHEN OLD.completed_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'BOOKING_COMPLETED');
END;
CREATE TRIGGER completion_reminder AFTER UPDATE OF completed_at ON appointments WHEN NEW.completed_at IS NOT NULL BEGIN
  UPDATE appointment_reminders SET state='suppressed',due_at=NULL WHERE shop_id=NEW.shop_id AND appointment_id=NEW.id;
END;

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 99999999),
  paid_on TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('pix','cash','card')),
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(shop_id,request_key),
  UNIQUE(shop_id,appointment_id),
  FOREIGN KEY(shop_id,appointment_id) REFERENCES appointments(shop_id,id),
  FOREIGN KEY(shop_id,customer_id) REFERENCES customers(shop_id,id),
  FOREIGN KEY(shop_id,service_id) REFERENCES services(shop_id,id)
);
CREATE INDEX receipts_period ON receipts(shop_id,paid_on,id);
