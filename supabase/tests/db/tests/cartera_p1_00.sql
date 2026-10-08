-- CARTERA-P1 (131) · «Mi cartera» canónica (cc_cartera) por identidad del servidor + «Cartera histórica (Odoo)»
-- separada por equivalencias EXPLÍCITAS (igualdad exacta). Escenarios del bloque: pertenencia, aislamiento entre
-- vendedores, histórico ≠ asignado, reasignación y desactivación, doctor/almacén/anónimo rechazados, nombres
-- duplicados o parecidos, identidad de usuario ≠ id de cliente, permisos y SECURITY DEFINER.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  dDavid uuid := tests.user('doctor'); d2 uuid := tests.user('doctor');
  sLucia uuid := tests.user('pos'); sAle uuid := tests.user('pos'); sAna1 uuid := tests.user('pos'); sAna2 uuid := tests.user('pos'); sInact uuid := tests.user('pos');
  vWh uuid := tests.user('warehouse');
  cuDavid uuid; cu2 uuid; h1 uuid; h2 uuid; h3 uuid; h4 uuid;
  r jsonb; n int; n0 int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (sLucia, sAle, sAna1, sAna2);
  update public.profiles set full_name = 'Ana Ruiz' where id in (sAna1, sAna2);   -- nombres DUPLICADOS
  cuDavid := tests.cliente(dDavid); cu2 := tests.cliente(d2);
  update public.customers set seller_name = null where id = cuDavid;              -- como en producción: portal sin seller_name
  insert into public.customers (full_name, email, phone, active, seller_name) values ('Hist Uno', 'h1@test.local', '6690000001', true, 'Alejandra Cazarez Bojorquez') returning id into h1;
  insert into public.customers (full_name, email, phone, active, seller_name) values ('Hist Dos', 'h2@test.local', '6690000002', true, 'Alejandra Cazarez Bojorquez') returning id into h2;
  insert into public.customers (full_name, email, phone, active, seller_name) values ('Hist Parecido', 'h3@test.local', '6690000003', true, 'Alejandra Cazarez') returning id into h3;         -- parecido
  insert into public.customers (full_name, email, phone, active, seller_name) values ('Hist Mayúsculas', 'h4@test.local', '6690000004', true, 'ALEJANDRA CAZAREZ BOJORQUEZ') returning id into h4;   -- otra grafía
  perform tests.act_as(v_admin);
  perform public.cc_cartera_asignar(dDavid, sLucia, 'piloto');
  perform tests.act_as_service();
  select count(*) into n0 from public.cc_cartera;

  -- ══ 1 · David pertenece a Lucía (aunque seller_name sea NULL); id de cliente ≠ id de perfil ══
  perform tests.act_as(sLucia);
  r := public.cc_mi_cartera();
  perform tests.eq(jsonb_array_length(r), 1, '1 · Lucía ve 1 cliente asignado');
  perform tests.eq((r -> 0 ->> 'profile_id')::uuid, dDavid, '1 · es David (perfil)');
  perform tests.eq((r -> 0 ->> 'customer_id')::uuid, cuDavid, '1 · con su id de CLIENTE (customers)');
  perform tests.ok(cuDavid <> dDavid, '1 · identidad de usuario y de cliente son distintas (no intercambiables)');

  -- ══ 2 · David NO pertenece a Alejandra; un vendedor no obtiene asignaciones ajenas ══
  perform tests.act_as(sAle);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera()), 0, '2 · Alejandra no ve a David');
  perform tests.ok(to_regprocedure('public.cc_mi_cartera(uuid)') is null and to_regprocedure('public.cc_mi_cartera_historica(uuid)') is null,
                   '2 · sin parámetro de vendedor: no se puede pedir la cartera de otro');

  -- ══ 3 · nombres duplicados: la cartera es por id, nunca por nombre ══
  perform tests.act_as(v_admin);
  perform public.cc_cartera_asignar(d2, sAna1, 'duplicados');
  perform tests.act_as(sAna1);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera()), 1, '3 · Ana Ruiz (1) ve su cliente');
  perform tests.act_as(sAna2);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera()), 0, '3 · la OTRA Ana Ruiz (mismo nombre) no ve nada');

  -- ══ 4 · reasignación reflejada al instante ══
  perform tests.act_as(v_admin);
  perform public.cc_cartera_asignar(dDavid, sAle, 'reasignación de prueba');
  perform tests.act_as(sLucia);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera()), 0, '4 · tras reasignar, Lucía ya no ve a David');
  perform tests.act_as(sAle);
  perform tests.eq((public.cc_mi_cartera() -> 0 ->> 'profile_id')::uuid, dDavid, '4 · Alejandra lo ve de inmediato');
  perform tests.act_as(v_admin);
  perform public.cc_cartera_asignar(dDavid, sLucia, 'regreso');

  -- ══ 5 · rechazos: doctor, almacén, vendedor INACTIVO, anónimo ══
  perform tests.act_as(dDavid);
  perform tests.throws('select public.cc_mi_cartera()', 'NO_AUTORIZADO', '5 · el doctor no lee carteras');
  perform tests.throws('select public.cc_mi_cartera_historica()', 'NO_AUTORIZADO', '5 · ni la histórica');
  perform tests.act_as(vWh);
  perform tests.throws('select public.cc_mi_cartera()', 'NO_AUTORIZADO', '5 · almacén tampoco');
  perform tests.act_as_service();
  update public.profiles set active = false where id = sInact;
  perform tests.act_as(sInact);
  perform tests.throws('select public.cc_mi_cartera()', 'NO_AUTORIZADO', '5 · vendedor desactivado: rechazado');
  perform tests.act_as_anon();
  perform tests.throws('select public.cc_mi_cartera()', 'permission denied', '5 · anónimo sin EXECUTE');
  perform tests.throws('select public.cc_mi_cartera_historica()', 'permission denied', '5 · anónimo sin EXECUTE (histórica)');

  -- ══ 6 · desactivar al vendedor dueño: deja de leer; la asignación NO se toca ══
  perform tests.act_as_service();
  update public.profiles set active = false where id = sLucia;
  perform tests.act_as(sLucia);
  perform tests.throws('select public.cc_mi_cartera()', 'NO_AUTORIZADO', '6 · Lucía desactivada no lee su cartera');
  perform tests.act_as_service();
  perform tests.ok(exists (select 1 from public.cc_cartera where profile_id = dDavid and seller_profile_id = sLucia), '6 · la asignación sigue intacta (no se reasigna sola)');
  update public.profiles set active = true where id = sLucia;

  -- ══ 7 · histórica: sin equivalencia no hay nada (nunca por parecido) ══
  perform tests.act_as(sAle);
  r := public.cc_mi_cartera_historica();
  perform tests.eq(jsonb_array_length(r -> 'clientes'), 0, '7 · sin equivalencia autorizada: histórica vacía');
  perform tests.eq(jsonb_array_length(r -> 'equivalencias'), 0, '7 · sin equivalencias');

  -- ══ 8 · administración de equivalencias: solo Dirección, validada y auditada ══
  perform tests.throws(format('select public.cc_equivalencia_historica_guardar(%L, %L, %L)', 'Alejandra Cazarez Bojorquez', sAle, 'x'), 'NO_AUTORIZADO', '8 · el vendedor no se autoasigna históricos');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_equivalencia_historica_guardar(%L, %L, %L)', 'Nadie Así', sAle, 'x'), 'EQUIVALENCIA_INVALIDA', '8 · nombre que ningún cliente tiene');
  perform tests.throws(format('select public.cc_equivalencia_historica_guardar(%L, %L, %L)', 'Alejandra Cazarez Bojorquez', dDavid, 'x'), 'EQUIVALENCIA_INVALIDA', '8 · el perfil debe ser de ventas');
  perform tests.throws(format('select public.cc_equivalencia_historica_guardar(%L, %L, %L)', 'Alejandra Cazarez Bojorquez', sAle, ' '), 'MOTIVO_REQUERIDO', '8 · motivo obligatorio');
  r := public.cc_equivalencia_historica_guardar('Alejandra Cazarez Bojorquez', sAle, 'equivalencia confirmada por el dueño');
  perform tests.eq(r ->> 'idempotente', 'false', '8 · equivalencia registrada');
  perform tests.eq(public.cc_equivalencia_historica_guardar('Alejandra Cazarez Bojorquez', sAle, 'repetida') ->> 'idempotente', 'true', '8 · idempotente');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.cc_cartera_historica_eventos where accion = 'equivalencia_guardada'), 1, '8 · un evento de auditoría');
  perform tests.act_as(v_admin);
  r := public.cc_equivalencias_historicas();
  perform tests.ok(exists (select 1 from jsonb_array_elements(r -> 'nombres_odoo') x where x ->> 'seller_name_odoo' = 'Alejandra Cazarez Bojorquez' and (x ->> 'equivalente')::boolean), '8 · Dirección ve el nombre como equivalente');

  -- ══ 9 · histórica = igualdad EXACTA; histórico NO se convierte en asignado ══
  perform tests.act_as(sAle);
  r := public.cc_mi_cartera_historica();
  perform tests.eq(jsonb_array_length(r -> 'clientes'), 2, '9 · solo los 2 con el texto EXACTO');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r -> 'clientes') x where (x ->> 'customer_id')::uuid in (h3, h4)), '9 · ni el parecido ni otra grafía');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.cc_mi_cartera()) x where (x ->> 'customer_id')::uuid in (h1, h2)), '9 · los históricos NO aparecen en Mi cartera');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.cc_cartera), n0 + 1, '9 · cc_cartera sin cambios por la equivalencia (solo la asignación de la prueba 3)');
  perform tests.act_as(sLucia);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera_historica() -> 'clientes'), 0, '9 · Lucía no recibe históricos ajenos');

  -- ══ 10 · mover y borrar equivalencias (auditado) ══
  perform tests.act_as(v_admin);
  perform public.cc_equivalencia_historica_guardar('Alejandra Cazarez Bojorquez', sLucia, 'corrección');
  perform tests.act_as(sAle);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera_historica() -> 'clientes'), 0, '10 · al mover la equivalencia, Alejandra la pierde');
  perform tests.act_as(v_admin);
  perform tests.eq(public.cc_equivalencia_historica_borrar('Alejandra Cazarez Bojorquez', 'retiro') ->> 'borrada', 'true', '10 · borrada');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.cc_cartera_historica_eventos), 3, '10 · guardada + movida + borrada auditadas');
  perform tests.act_as(sLucia);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera_historica() -> 'clientes'), 0, '10 · sin equivalencia, sin históricos');

  -- ══ 11 · tablas base sin acceso directo; RPC con SECURITY DEFINER y search_path fijo ══
  perform tests.act_as(sLucia);
  perform tests.throws('select count(*) from public.cc_cartera', 'permission denied', '11 · cc_cartera no se lee directo');
  perform tests.throws('select count(*) from public.cc_cartera_historica_equivalencias', 'permission denied', '11 · equivalencias no se leen directo');
  perform tests.throws('select count(*) from public.cc_cartera_historica_eventos', 'permission denied', '11 · eventos no se leen directo');
  perform tests.act_as_service();
  perform tests.ok((select bool_and(p.prosecdef and 'search_path=public' = any (p.proconfig)) from pg_proc p
                     where p.proname in ('cc_mi_cartera', 'cc_mi_cartera_historica', 'cc_equivalencias_historicas', 'cc_equivalencia_historica_guardar', 'cc_equivalencia_historica_borrar', '_cc_vendedor_consulta')),
                   '11 · SECURITY DEFINER con search_path=public en todas');
  perform tests.ok(not has_function_privilege('anon', 'public.cc_mi_cartera()', 'execute') and not has_function_privilege('authenticated', 'public._cc_vendedor_consulta()', 'execute'),
                   '11 · anon sin EXECUTE; el ayudante interno no es invocable');

  -- ══ 12 · Dirección: lee su propia cartera (vacía), no la de otros ══
  perform tests.act_as(v_admin);
  perform tests.eq(jsonb_array_length(public.cc_mi_cartera()), 0, '12 · Dirección no hereda carteras ajenas');
end $t$;
rollback;
