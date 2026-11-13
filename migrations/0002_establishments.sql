-- Evolução da base existente: todas as reservas antigas pertencem à TOMAZ BARBER.
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Bahia',
  logo_url TEXT,
  description TEXT NOT NULL DEFAULT ''
);
INSERT INTO shops VALUES
  ('tomaz-barber','tomaz-barber','TOMAZ BARBER','America/Bahia','/tomaz-barber-logo.jpg','Seu estilo. Seu tempo.');

CREATE TABLE professionals (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (shop_id,id)
);
INSERT INTO professionals VALUES ('tomaz-barber','principal','Tomaz');

CREATE TABLE services (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK(duration > 0 AND duration <= 240 AND duration % 10 = 0),
  price TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id,id)
);
INSERT INTO services VALUES
  ('tomaz-barber','corte','Corte masculino',30,'R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão','Seu estilo, no detalhe.',1),
  ('tomaz-barber','barba','Barba',20,'R$ 15,00','Contorno preciso e acabamento.',2),
  ('tomaz-barber','corte-barba','Corte com barba',40,'R$ 38,00','O cuidado completo.',3),
  ('tomaz-barber','pe','Pé de cabelo',20,'R$ 15,00','Acabamento que faz a diferença.',4),
  ('tomaz-barber','pe-barba','Pé com barba',60,'R$ 20,00','Cabelo alinhado, barba em dia.',5),
  ('tomaz-barber','pigmentacao','Pigmentação',60,'R$ 20,00','Mais definição para o seu visual.',6),
  ('tomaz-barber','luzes','Luzes',60,'A partir de R$ 60,00','Um novo toque de personalidade.',7);

CREATE TABLE working_hours (
  shop_id TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  opens_at INTEGER NOT NULL CHECK(opens_at >= 0 AND opens_at % 10 = 0),
  closes_at INTEGER NOT NULL CHECK(closes_at <= 1440 AND closes_at > opens_at AND closes_at % 10 = 0),
  PRIMARY KEY(shop_id,professional_id,weekday),
  FOREIGN KEY(shop_id,professional_id) REFERENCES professionals(shop_id,id)
);
INSERT INTO working_hours SELECT 'tomaz-barber','principal',CAST(value AS INTEGER),450,1200 FROM json_each('[1,2,3,4,5,6]');

CREATE TABLE customers (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(shop_id,id),
  UNIQUE(shop_id,phone)
);
INSERT INTO customers (shop_id,id,full_name,phone,created_at)
SELECT 'tomaz-barber',lower(hex(randomblob(16))),
  (SELECT a.customer_name FROM appointments a WHERE a.customer_phone = p.customer_phone ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
  p.customer_phone,p.created_at
FROM (SELECT customer_phone,min(created_at) AS created_at FROM appointments GROUP BY customer_phone) p;

-- Primeiro removemos a tabela filha. O D1 executa a migração de forma transacional.
DROP TRIGGER reserve_segments;
DROP TABLE occupied_segments;
ALTER TABLE appointments RENAME TO legacy_appointments;
DROP INDEX appointments_start;
CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  professional_id TEXT NOT NULL DEFAULT 'principal',
  customer_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('link','hub')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  price_label TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0 AND duration_minutes <= 240 AND duration_minutes % 10 = 0),
  starts_at INTEGER NOT NULL CHECK(starts_at % 600 = 0),
  ends_at INTEGER NOT NULL CHECK(ends_at = starts_at + duration_minutes * 60),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(shop_id,request_key),
  UNIQUE(shop_id,professional_id,id),
  FOREIGN KEY(shop_id,professional_id) REFERENCES professionals(shop_id,id),
  FOREIGN KEY(shop_id,customer_id) REFERENCES customers(shop_id,id),
  FOREIGN KEY(shop_id,service_id) REFERENCES services(shop_id,id)
);
CREATE INDEX appointments_start ON appointments(shop_id,professional_id,starts_at);
CREATE INDEX appointments_customer ON appointments(shop_id,customer_id,starts_at);
CREATE TABLE occupied_segments (
  shop_id TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  appointment_id TEXT NOT NULL,
  PRIMARY KEY(shop_id,professional_id,starts_at),
  FOREIGN KEY(shop_id,professional_id,appointment_id) REFERENCES appointments(shop_id,professional_id,id) ON DELETE CASCADE
);
CREATE TRIGGER reserve_segments AFTER INSERT ON appointments BEGIN
  INSERT INTO occupied_segments (shop_id,professional_id,starts_at,appointment_id)
  SELECT NEW.shop_id,NEW.professional_id,NEW.starts_at+CAST(value AS INTEGER)*600,NEW.id
  FROM json_each('[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]')
  WHERE CAST(value AS INTEGER) < NEW.duration_minutes / 10;
END;
INSERT INTO appointments
  (id,shop_id,professional_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at,created_at)
SELECT a.id,'tomaz-barber','principal',c.id,a.request_key,a.request_fingerprint,a.origin,a.customer_name,a.customer_phone,a.service_id,a.service_name,a.price_label,a.duration_minutes,a.starts_at,a.ends_at,a.created_at
FROM legacy_appointments a JOIN customers c ON c.shop_id='tomaz-barber' AND c.phone=a.customer_phone;
DROP TABLE legacy_appointments;

-- Sessões anteriores à separação não indicavam o estabelecimento: novo login obrigatório.
DROP TABLE admin_sessions;
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  expires_at INTEGER NOT NULL
);
DELETE FROM login_attempts;
