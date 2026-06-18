-- Seed products and lots based on the demo.
-- Home Care products with real MXN prices; Professional products price NULL / 'a consultar'.

-- PRODUCTS
INSERT INTO products (id, sku, name, line, category, description, price, unit, metadata)
VALUES
  (gen_random_uuid(), 'MGP-90', 'Mascarilla GP', 'cosm', 'Bestseller', 'Hidrogel con péptidos. Tratamiento intensivo en una aplicación.', 890::numeric, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'GS-114', 'Golden Serum', 'cosm', 'Premium', 'Suero antiedad con extractos placentarios. Aplicación nocturna.', 1890::numeric, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'AB-50', 'Antiaging Booster', 'cosm', 'Antiedad', 'Concentrado intensivo. Potencia cualquier rutina antiedad.', 1450::numeric, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'SH-19', 'Stemhair', 'cosm', 'Capilar', 'Tratamiento capilar. Densidad y crecimiento desde la raíz.', 1290::numeric, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'PL-12', 'Plumper', 'cosm', 'Nuevo', 'Voluminizador labial con péptidos. Efecto inmediato.', 680::numeric, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'GP-300', 'Golden Placenta', 'prof', 'Bandera · 300 kDa', 'Extractos frescos bioactivos de placenta humana en máxima concentración.', NULL, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'UFS-11', 'Ultrafiltrados UFS', 'prof', '11 variantes · 10 kDa', 'Péptidos nativos por ultrafiltración. 11 variantes según órgano diana.', NULL, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'GV-07', 'Golden V', 'prof', 'Vegetal · + GSH', 'Origen vegetal con glutatión. Bajo riesgo inmunológico.', NULL, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'SAC-21', 'Suero Antiedad Cellular', 'prof', 'Inyectable · Antiedad', 'Suero inyectable con péptidos celulares activos. Regeneración tisular dermal profunda.', NULL, 'unit', jsonb '{}'),
  (gen_random_uuid(), 'STL-44', 'Stoplip', 'prof', 'Inyectable · Lipolítico', 'Mesoterapia inyectable para grasa localizada y lipodistrofia.', NULL, 'unit', jsonb '{}');

-- Note: Above insertions use gen_random_uuid(); if using pgcrypto, ensure extension enabled.

-- For each product, create a sample lot (quantities from demo)
INSERT INTO lots (id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata)
SELECT gen_random_uuid(), p.id, p.sku || '-LOT1', now()::date, (now() + interval '180 days')::date, 50, 'Culiacán', jsonb '{}' FROM products p WHERE p.sku IN ('MGP-90','GS-114','AB-50','SH-19','PL-12');

-- Special lots matching demo codes and counts
INSERT INTO lots (id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata)
SELECT gen_random_uuid(), p.id, 'GP-300', now()::date, '2027-03-01'::date, 14, 'Praga', jsonb '{}' FROM products p WHERE p.sku = 'GP-300';

INSERT INTO lots (id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata)
SELECT gen_random_uuid(), p.id, 'UFS-11', now()::date, '2026-11-01'::date, 22, 'Culiacán', jsonb '{}' FROM products p WHERE p.sku = 'UFS-11';

INSERT INTO lots (id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata)
SELECT gen_random_uuid(), p.id, 'GV-07', now()::date, '2027-01-01'::date, 5, 'Culiacán', jsonb '{}' FROM products p WHERE p.sku = 'GV-07';

INSERT INTO lots (id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata)
SELECT gen_random_uuid(), p.id, 'SAC-21', now()::date, '2026-10-01'::date, 18, 'Culiacán', jsonb '{}' FROM products p WHERE p.sku = 'SAC-21';

INSERT INTO lots (id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata)
SELECT gen_random_uuid(), p.id, 'STL-44', now()::date, '2026-04-01'::date, 9, 'Culiacán', jsonb '{}' FROM products p WHERE p.sku = 'STL-44';

-- End of seed
