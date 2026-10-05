-- CC-0B · Dedupe de prospectos indexado: misma regla que capture-lead (correo en
-- minúsculas, o teléfono con ≥ 7 dígitos), sin barrer la tabla; solo el servidor lo llama.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_a uuid; v_b uuid;
begin
  perform tests.act_as_service();
  insert into public.prospects (name, email, phone, source, status) values ('Ana', 'Ana.Perez@Clinica.MX', '+52 (669) 123-4567', 'Landing', 'nuevo') returning id into v_a;
  insert into public.prospects (name, email, phone, source, status) values ('Beto', null, '5551234', 'WhatsApp', 'nuevo') returning id into v_b;

  perform tests.eq(public.buscar_prospecto_duplicado('ana.perez@clinica.mx', null), v_a, 'correo en minúsculas → encuentra a Ana');
  perform tests.eq(public.buscar_prospecto_duplicado('  ANA.PEREZ@CLINICA.MX ', null), v_a, 'correo con espacios/mayúsculas → Ana');
  perform tests.eq(public.buscar_prospecto_duplicado(null, '52-669-123-4567'), v_a, 'teléfono con los mismos dígitos (formato distinto) → Ana');
  perform tests.eq(public.buscar_prospecto_duplicado(null, '6691234567'), null::uuid, 'sin lada país = dígitos distintos → no es el mismo (regla ACTUAL de capture-lead, no se amplía en CC-0B)');
  perform tests.eq(public.buscar_prospecto_duplicado(null, '123456'), null::uuid, '< 7 dígitos → nunca deduplica por teléfono');
  perform tests.eq(public.buscar_prospecto_duplicado(null, '555-1234'), v_b, '7 dígitos exactos → Beto');
  perform tests.eq(public.buscar_prospecto_duplicado('nadie@x.mx', '0000000'), null::uuid, 'sin coincidencia → null');
  perform tests.eq(public.buscar_prospecto_duplicado('', ''), null::uuid, 'vacíos → null (no empareja correos nulos)');
  perform tests.eq(public.buscar_prospecto_duplicado(null, null), null::uuid, 'nulos → null');

  -- índices de expresión presentes (el plan se mide aparte, en el reporte)
  perform tests.ok(exists (select 1 from pg_indexes where tablename = 'prospects' and indexname = 'idx_prospects_email_lower')
               and exists (select 1 from pg_indexes where tablename = 'prospects' and indexname = 'idx_prospects_phone_digits'),
    'índices de expresión creados');

  -- privilegios
  perform tests.act_as_anon();
  perform tests.throws('select public.buscar_prospecto_duplicado(''a@x.mx'', null)', 'permission denied', 'anon no ejecuta el dedupe');
  perform tests.act_as(v_doc);
  perform tests.throws('select public.buscar_prospecto_duplicado(''a@x.mx'', null)', 'permission denied', 'doctor no ejecuta el dedupe');
  perform tests.act_as(v_admin);
  perform tests.throws('select public.buscar_prospecto_duplicado(''a@x.mx'', null)', 'permission denied', 'Dirección tampoco (solo servidor)');
  perform tests.act_as_owner();
end $t$;
rollback;
