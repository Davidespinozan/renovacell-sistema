-- HERRAMIENTAS DEL VENDEDOR · bloque B (20270215) · clínica o doctor y la especialidad, en la FICHA (con o sin cuenta). La
-- edita su vendedor, el jefe de ventas o Dirección; el vendedor clasifica rápido su cartera; Dirección agrega especialidades.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sJefe uuid := tests.user('pos'); d1 uuid := tests.user('doctor');
  cu1 uuid; cuSin uuid; cuOtro uuid; r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","jefe_ventas"]}' where id = sJefe;
  cu1 := tests.cliente(d1); update public.customers set full_name = 'Ana Pérez' where id = cu1;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  insert into public.customers (full_name, active) values ('Laura Gómez', true) returning id into cuSin;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cuSin, s1);
  insert into public.customers (full_name, active) values ('Cliente De Otro', true) returning id into cuOtro;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cuOtro, s2);

  -- ══ 1 · catálogo ══
  perform tests.ok((select count(*) = 9 and bool_and(activa) from public.especialidades), '1 · 9 especialidades base, con "Otra"');

  -- ══ 2 · su vendedor clasifica (con cuenta o sin cuenta) ══
  perform tests.act_as(s1);
  r := public.cliente_perfil_comercial_guardar(cuSin, 'doctor', 'dermatologia', null);
  perform tests.ok(r ->> 'tipo' = 'doctor' and r ->> 'especialidad_nombre' = 'Dermatología', '2 · cliente sin cuenta: doctor, dermatología');
  perform tests.ok((select perfil_actualizado_por = s1 from public.customers where id = cuSin), '2 · queda quién lo clasificó');
  r := public.cliente_perfil_comercial_guardar(cu1, 'clinica', 'otra', '  Medicina regenerativa ');
  perform tests.eq(r ->> 'especialidad_nombre', 'Medicina regenerativa', '2 · "Otra" con su texto');
  perform tests.throws(format('select public.cliente_perfil_comercial_guardar(%L, %L, %L, null)', cu1, 'clinica', 'otra'), 'DATO_INVALIDO:especialidad_otra', '2 · "Otra" exige el texto');
  perform tests.throws(format('select public.cliente_perfil_comercial_guardar(%L, %L, null, null)', cu1, 'farmacia'), 'DATO_INVALIDO:tipo', '2 · solo doctor o clínica');
  perform tests.throws(format('select public.cliente_perfil_comercial_guardar(%L, null, %L, null)', cu1, 'astrologia'), 'DATO_INVALIDO:especialidad', '2 · solo especialidades del catálogo');
  r := public.cliente_perfil_comercial_guardar(cu1, 'doctor', 'medicina_estetica', 'ignorado');
  perform tests.ok(r -> 'especialidad_otra' = 'null'::jsonb, '2 · el texto de "Otra" se limpia si cambia la especialidad');
  perform tests.throws(format('select public.cliente_perfil_comercial_guardar(%L, %L, null, null)', cuOtro, 'doctor'), 'NO_AUTORIZADO', '2 · un vendedor no clasifica clientes de otro');
  perform tests.throws(format('select public.cliente_perfil_comercial(%L)', cuOtro), 'NO_AUTORIZADO', '2 · ni los ve');

  -- ══ 3 · clasificar rápido: su cartera, avance y solo los pendientes ══
  r := public.mis_clientes_perfil(null, false);
  perform tests.ok((r ->> 'total')::int = 2 and (r ->> 'clasificados')::int = 2 and (r ->> 'doctores')::int = 2, '3 · avance de SU cartera (no la de otro)');
  perform tests.eq((public.mis_clientes_perfil(null, true) ->> 'encontrados')::int, 0, '3 · sin pendientes');
  perform tests.eq((public.mis_clientes_perfil('LAURA', false) -> 'clientes' -> 0 ->> 'nombre'), 'Laura Gómez', '3 · busca por nombre');
  perform tests.act_as(sJefe);
  perform tests.ok((public.mis_clientes_perfil(null, true) ->> 'total')::int >= 3 and exists (select 1 from jsonb_array_elements(public.mis_clientes_perfil(null, true) -> 'clientes') x where x ->> 'customer_id' = cuOtro::text), '3 · el jefe de ventas ve y clasifica a todos');
  perform public.cliente_perfil_comercial_guardar(cuOtro, 'clinica', null, null);
  perform tests.act_as(d1);
  perform tests.throws('select public.mis_clientes_perfil()', 'NO_AUTORIZADO', '3 · un doctor no');

  -- ══ 4 · Dirección agrega especialidades ══
  perform tests.act_as(s1);
  perform tests.throws('select public.especialidad_guardar(''Medicina regenerativa'')', 'NO_AUTORIZADO', '4 · el vendedor no agrega especialidades');
  perform tests.act_as(v_admin);
  perform tests.eq(public.especialidad_guardar('Medicina regenerativa') ->> 'clave', 'medicina_regenerativa', '4 · Dirección la agrega');
  perform tests.act_as(s1);
  perform tests.eq(public.cliente_perfil_comercial_guardar(cuSin, 'doctor', 'medicina_regenerativa', null) ->> 'especialidad_nombre', 'Medicina regenerativa', '4 · y ya se puede usar');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.especialidades', 'permission denied', '4 · anónimo no lee el catálogo');
end $t$;
rollback;
