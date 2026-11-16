-- Evolução aditiva: não modifica reservas, preços ou durações existentes.
ALTER TABLE services ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE services ADD COLUMN payment_conditions TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
