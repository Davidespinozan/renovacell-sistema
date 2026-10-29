\set ON_ERROR_STOP 1
do $$
declare adm uuid := (select id from profiles where email='antonio@e2e.mx'); rob uuid := (select id from profiles where email='roberto@e2e.mx');
  ale uuid := (select id from profiles where email='alejandra@e2e.mx'); d1 uuid := (select id from profiles where email='doctora@e2e.mx');
  d2 uuid := (select id from profiles where email='doctor2@e2e.mx'); c1 uuid; c2 uuid; c3 uuid; p record; i int := 0;
begin
  insert into customers (full_name, email, phone, city, profile_id, source, active) values ('Dra. Sofía Prueba', 'doctora@e2e.mx', '6671234567', 'Culiacán', d1, 'portal', true) returning id into c1;
  insert into customers (full_name, email, phone, city, profile_id, source, active) values ('Dr. Jorge Prueba', 'doctor2@e2e.mx', '6679876543', 'Mazatlán', d2, 'portal', true) returning id into c2;
  insert into customers (full_name, phone, city, source, active) values ('Clínica Mostrador Prueba', '6670001111', 'Culiacán', 'odoo', true) returning id into c3;
  insert into cc_cartera (profile_id, seller_profile_id, asignado_por, motivo) values (d1, rob, adm, 'e2e');
  insert into cc_cartera_clientes (customer_id, seller_profile_id, asignado_por, motivo) values (c1, rob, adm, 'e2e'), (c2, ale, adm, 'e2e'), (c3, rob, adm, 'e2e');
  insert into doctor_locations (doctor_id, customer_id, name, line1, exterior_number, neighborhood, postal_code, city, state, country, contact_name, contact_phone, is_default, active)
    values (d1, c1, 'Consultorio', 'Av. Obregón', '123', 'Centro', '80000', 'Culiacán', 'Sinaloa', 'MX', 'Sofía', '6671234567', true, true),
           (d2, c2, 'Clínica', 'Av. del Mar', '45', 'Zona Dorada', '82110', 'Mazatlán', 'Sinaloa', 'MX', 'Jorge', '6679876543', true, true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  for p in select id, sku from products where active and sellable and price > 0 and not exists (select 1 from products c where c.parent_product_id = products.id) order by price desc limit 12 loop
    i := i + 1;
    perform recibir_lote(gen_random_uuid(), p.id, 'E2E-' || i, current_date + 400, 30, null, 'sin_orden', 100, 'e2e', null);
  end loop;
  raise notice 'lotes %', i;
end $$;
select p.sku, p.name, p.price, l.quantity from lots l join products p on p.id = l.product_id order by p.price desc;
