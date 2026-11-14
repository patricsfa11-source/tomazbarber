ALTER TABLE appointments ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled'));
ALTER TABLE appointments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE appointments ADD COLUMN cancelled_at INTEGER;
ALTER TABLE appointments ADD COLUMN booking_channel TEXT NOT NULL DEFAULT 'link' CHECK(booking_channel IN ('link','hub'));
ALTER TABLE appointments ADD COLUMN schedule_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN action_key TEXT;
ALTER TABLE appointments ADD COLUMN action_fingerprint TEXT;
UPDATE appointments SET booking_channel = origin;
CREATE UNIQUE INDEX appointments_shop_id ON appointments(shop_id,id);

CREATE TABLE schedule_settings (
  shop_id TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  agenda_revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(shop_id,professional_id),
  FOREIGN KEY(shop_id,professional_id) REFERENCES professionals(shop_id,id)
);
INSERT INTO schedule_settings (shop_id,professional_id) SELECT shop_id,id FROM professionals;
CREATE TABLE weekly_breaks (
  shop_id TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  starts_at INTEGER NOT NULL CHECK(starts_at >= 0 AND starts_at % 10 = 0),
  ends_at INTEGER NOT NULL CHECK(ends_at <= 1440 AND ends_at > starts_at AND ends_at % 10 = 0),
  PRIMARY KEY(shop_id,professional_id,weekday,starts_at),
  FOREIGN KEY(shop_id,professional_id) REFERENCES professionals(shop_id,id)
);
CREATE TABLE special_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL CHECK(to_date >= from_date),
  closed INTEGER NOT NULL CHECK(closed IN (0,1)),
  opens_at INTEGER NOT NULL CHECK(opens_at >= 0 AND opens_at % 10 = 0),
  closes_at INTEGER NOT NULL CHECK(closes_at <= 1440 AND closes_at > opens_at AND closes_at % 10 = 0),
  breaks_json TEXT NOT NULL CHECK(json_valid(breaks_json)),
  FOREIGN KEY(shop_id,professional_id) REFERENCES professionals(shop_id,id)
);
CREATE INDEX special_hours_shop ON special_hours(shop_id,professional_id,from_date,to_date);
CREATE TABLE availability_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL CHECK(to_date >= from_date),
  starts_at INTEGER NOT NULL CHECK(starts_at >= 0 AND starts_at % 10 = 0),
  ends_at INTEGER NOT NULL CHECK(ends_at <= 1440 AND ends_at > starts_at AND ends_at % 10 = 0),
  scope TEXT NOT NULL CHECK(scope IN ('online','all')),
  FOREIGN KEY(shop_id,professional_id) REFERENCES professionals(shop_id,id)
);
CREATE INDEX availability_rules_shop ON availability_rules(shop_id,professional_id,from_date,to_date);
CREATE TABLE schedule_changes (
  shop_id TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  expected_agenda_revision INTEGER NOT NULL,
  command_json TEXT NOT NULL CHECK(json_valid(command_json)),
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  PRIMARY KEY(shop_id,request_key),
  FOREIGN KEY(shop_id,professional_id) REFERENCES professionals(shop_id,id)
);
CREATE TRIGGER schedule_change_guard BEFORE INSERT ON schedule_changes BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM schedule_settings WHERE shop_id=NEW.shop_id AND professional_id=NEW.professional_id
      AND revision=NEW.expected_revision AND agenda_revision=NEW.expected_agenda_revision
  ) THEN RAISE(ABORT,'SCHEDULE_CHANGED') END;
END;
CREATE TRIGGER schedule_change_revision AFTER INSERT ON schedule_changes BEGIN
  UPDATE schedule_settings SET revision=revision+1 WHERE shop_id=NEW.shop_id AND professional_id=NEW.professional_id;
END;
CREATE TRIGGER appointment_schedule_guard BEFORE INSERT ON appointments BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM schedule_settings WHERE shop_id=NEW.shop_id AND professional_id=NEW.professional_id AND revision=NEW.schedule_revision
  ) THEN RAISE(ABORT,'SCHEDULE_CHANGED') END;
END;
CREATE TRIGGER reschedule_schedule_guard BEFORE UPDATE OF starts_at,ends_at ON appointments WHEN NEW.status='confirmed' BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM schedule_settings WHERE shop_id=NEW.shop_id AND professional_id=NEW.professional_id AND revision=NEW.schedule_revision
  ) THEN RAISE(ABORT,'SCHEDULE_CHANGED') END;
END;
CREATE TRIGGER cancelled_stays_cancelled BEFORE UPDATE ON appointments WHEN OLD.status='cancelled' BEGIN
  SELECT RAISE(ABORT,'BOOKING_CANCELLED');
END;

-- Ao remarcar, primeiro tenta ocupar os novos segmentos. Só então libera os antigos.
-- Se qualquer INSERT colidir, o UPDATE e todos os efeitos dos triggers são revertidos.
CREATE TRIGGER update_segments AFTER UPDATE OF starts_at,ends_at,status ON appointments BEGIN
  INSERT INTO occupied_segments (shop_id,professional_id,starts_at,appointment_id)
  SELECT NEW.shop_id,NEW.professional_id,NEW.starts_at+CAST(value AS INTEGER)*600,NEW.id
  FROM json_each('[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]')
  WHERE NEW.status='confirmed' AND CAST(value AS INTEGER)<NEW.duration_minutes/10
    AND NOT EXISTS (
      SELECT 1 FROM occupied_segments s WHERE s.shop_id=NEW.shop_id AND s.professional_id=NEW.professional_id
        AND s.starts_at=NEW.starts_at+CAST(value AS INTEGER)*600 AND s.appointment_id=NEW.id
    );
  DELETE FROM occupied_segments WHERE shop_id=NEW.shop_id AND professional_id=NEW.professional_id AND appointment_id=NEW.id
    AND (NEW.status='cancelled' OR starts_at<NEW.starts_at OR starts_at>=NEW.ends_at);
END;
CREATE TABLE booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('created','rescheduled','cancelled')),
  old_start INTEGER,
  old_end INTEGER,
  new_start INTEGER NOT NULL,
  new_end INTEGER NOT NULL,
  action_key TEXT,
  action_fingerprint TEXT,
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(shop_id,appointment_id,version),
  UNIQUE(shop_id,action_key),
  FOREIGN KEY(shop_id,appointment_id) REFERENCES appointments(shop_id,id)
);
INSERT INTO booking_events (shop_id,appointment_id,version,kind,new_start,new_end,created_at)
SELECT shop_id,id,version,'created',starts_at,ends_at,created_at FROM appointments;
CREATE TABLE appointment_reminders (
  shop_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  booking_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('scheduled','suppressed','cancelled')),
  due_at INTEGER,
  PRIMARY KEY(shop_id,appointment_id),
  FOREIGN KEY(shop_id,appointment_id) REFERENCES appointments(shop_id,id)
);
INSERT INTO appointment_reminders
SELECT shop_id,id,version,CASE WHEN starts_at>unixepoch()+600 THEN 'scheduled' ELSE 'suppressed' END,
  CASE WHEN starts_at>unixepoch()+600 THEN starts_at-600 ELSE NULL END FROM appointments;
CREATE TABLE notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  booking_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('booking.created','booking.rescheduled','booking.cancelled')),
  state TEXT NOT NULL DEFAULT 'pending_integration' CHECK(state='pending_integration'),
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(shop_id,appointment_id,booking_version,kind),
  FOREIGN KEY(shop_id,appointment_id) REFERENCES appointments(shop_id,id)
);
CREATE TRIGGER appointment_created AFTER INSERT ON appointments BEGIN
  UPDATE schedule_settings SET agenda_revision=agenda_revision+1 WHERE shop_id=NEW.shop_id AND professional_id=NEW.professional_id;
  INSERT INTO booking_events (shop_id,appointment_id,version,kind,new_start,new_end) VALUES (NEW.shop_id,NEW.id,NEW.version,'created',NEW.starts_at,NEW.ends_at);
  INSERT INTO appointment_reminders VALUES (NEW.shop_id,NEW.id,NEW.version,CASE WHEN NEW.starts_at>unixepoch()+600 THEN 'scheduled' ELSE 'suppressed' END,CASE WHEN NEW.starts_at>unixepoch()+600 THEN NEW.starts_at-600 ELSE NULL END);
  INSERT INTO notification_outbox (shop_id,appointment_id,booking_version,kind) VALUES(NEW.shop_id,NEW.id,NEW.version,'booking.created');
END;
CREATE TRIGGER appointment_changed AFTER UPDATE OF starts_at,ends_at,status ON appointments BEGIN
  UPDATE schedule_settings SET agenda_revision=agenda_revision+1 WHERE shop_id=NEW.shop_id AND professional_id=NEW.professional_id;
  INSERT INTO booking_events (shop_id,appointment_id,version,kind,old_start,old_end,new_start,new_end,action_key,action_fingerprint)
  VALUES(NEW.shop_id,NEW.id,NEW.version,CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'rescheduled' END,OLD.starts_at,OLD.ends_at,NEW.starts_at,NEW.ends_at,NEW.action_key,NEW.action_fingerprint);
  INSERT INTO appointment_reminders VALUES (
    NEW.shop_id,NEW.id,NEW.version,
    CASE WHEN NEW.status='cancelled' THEN 'cancelled' WHEN NEW.starts_at>unixepoch()+600 THEN 'scheduled' ELSE 'suppressed' END,
    CASE WHEN NEW.status='confirmed' AND NEW.starts_at>unixepoch()+600 THEN NEW.starts_at-600 ELSE NULL END
  ) ON CONFLICT(shop_id,appointment_id) DO UPDATE SET booking_version=excluded.booking_version,state=excluded.state,due_at=excluded.due_at;
  INSERT INTO notification_outbox (shop_id,appointment_id,booking_version,kind)
  VALUES(NEW.shop_id,NEW.id,NEW.version,CASE WHEN NEW.status='cancelled' THEN 'booking.cancelled' ELSE 'booking.rescheduled' END);
END;
