-- IDENTIDAD DE CLIENTES (0761) · una sola búsqueda de identidad en todas las puertas; al aprobar, lo del registro pasa a la
-- ficha sin pisar nada; Dirección asigna cartera al aprobar.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor');
  cPrev uuid; cMail uuid; r jsonb; n int;
begin
  perform tests.act_as_service();
  -- ficha previa (sin cuenta) con el celular que luego usa la doctora al registrarse con OTRO correo
  insert into public.customers (full_name, phone, source) values ('Dra Previa', '6671112233', 'vendedor') returning id into cPrev;
  insert into public.customers (full_name, email, source) values ('Con Correo', 'correo@prueba.test', 'odoo') returning id into cMail;
  update public.profiles set meta = coalesce(meta, '{}') || jsonb_build_object('cedula', '12 345 678', 'specialty', 'dermatóloga',
    'shipping', jsonb_build_object('line1', 'Calle 1', 'colonia', 'Centro', 'cp', '80000', 'city', 'Culiacán', 'state', 'Sinaloa', 'phone', '667 111 2233')) where id = d1;

  perform tests.eq(public._especialidad_de_texto('Médico general'), 'medicina_general', 'esp · médico general no cae en estética');
  perform tests.eq(public._especialidad_de_texto('Pediatra'), 'otra', 'esp · sin catálogo → otra');

  perform tests.act_as(v_admin);
  select count(*) into n from public.customers;
  r := public.doctor_verificar(d1, true, null);
  perform tests.eq((r ->> 'customer_id')::uuid, cPrev, '1 · al aprobar se liga la ficha existente por TELÉFONO (antes solo correo → duplicado)');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.customers), n, '1 · no se crea otra ficha');
  perform tests.ok((select meta ->> 'cedula' = '12345678' and especialidad = 'dermatologia' from public.customers where id = cPrev), '2 · la cédula y la especialidad del registro pasan a la ficha');

  perform tests.act_as(v_admin);
  r := public.cliente_prospecto_crear('Otra Persona', '667 555 0000', 'doctor', null, 'CORREO@prueba.test');
  perform tests.ok(r ->> 'status' = 'existente' and (r ->> 'customer_id')::uuid = cMail, '3 · el alta también encuentra por correo');
  r := public.cliente_prospecto_crear('dra. ana prueba', '667 555 0001', 'doctor', null, null);
  perform tests.act_as_service();
  perform tests.ok((select full_name = 'dra. ana prueba' from public.customers where id = (r ->> 'customer_id')::uuid), '3 · el nombre se guarda como se escribió');
  perform tests.ok(exists (select 1 from public.customer_phones where customer_id = (r ->> 'customer_id')::uuid and etiqueta = 'whatsapp'), '3 · su celular queda como WhatsApp');

  perform tests.act_as(v_admin);
  r := public.admin_approve_doctor(d2, null, jsonb_build_object('full_name', 'Dra Dos', 'phone', '6670009999', 'meta', jsonb_build_object('seller_profile_id', s1)));
  perform tests.act_as_service();
  perform tests.ok(exists (select 1 from public.cc_cartera where profile_id = d2 and seller_profile_id = s1), '4 · la vendedora elegida al aprobar queda en la cartera');
end $t$;
rollback;
