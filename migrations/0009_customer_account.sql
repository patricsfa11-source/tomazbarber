-- O nome só é associado ao cadastro após confirmar a posse do número.
ALTER TABLE phone_challenges ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';
