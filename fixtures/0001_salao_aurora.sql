-- Unidade fictícia exclusiva de desenvolvimento e testes; não é criada pela migração.
INSERT INTO shops (id,slug,name,timezone,logo_url,description)
VALUES ('salao-aurora','salao-aurora','Salão Aurora','America/Bahia',NULL,'Salão fictício para testes.')
ON CONFLICT(id) DO NOTHING;
INSERT INTO professionals VALUES ('salao-aurora','principal','Aurora Exemplo') ON CONFLICT(shop_id,id) DO NOTHING;
INSERT INTO services VALUES
  ('salao-aurora','corte','Corte e finalização',60,'R$ 55,00','Serviço fictício do Salão Aurora.',1),
  ('salao-aurora','escova','Escova',30,'R$ 40,00','Escova fictícia para demonstração.',2)
ON CONFLICT(shop_id,id) DO NOTHING;
INSERT INTO working_hours
SELECT 'salao-aurora','principal',CAST(value AS INTEGER),540,1080 FROM json_each('[2,3,4,5,6]') WHERE true
ON CONFLICT(shop_id,professional_id,weekday) DO NOTHING;
INSERT INTO schedule_settings (shop_id,professional_id) VALUES ('salao-aurora','principal') ON CONFLICT(shop_id,professional_id) DO NOTHING;
