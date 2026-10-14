-- CARTERA-CLIENTES (152) · vendedor para cualquier cliente (con o sin cuenta), baja y reactivación, y que el vendedor
-- asignado vea y atienda a sus clientes sin cuenta. Solo Dirección asigna y da de baja.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sNo uuid := tests.user('pos');
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); dNueva uuid := tests.user('doctor');
  cuSin uuid; cuSin2 uuid; cuCon uuid; cuLiga uuid; cuLiga2 uuid; r jsonb; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  insert into public.customers (full_name, email, phone, active, source) values ('Clínica Sin Cuenta', 'sin@test.local', '6697770001', true, 'odoo') returning id into cuSin;
  insert into public.customers (full_name, active) values ('Otro Sin Cuenta', true) returning id into cuSin2;
  insert into public.customers (full_name, active) values ('Se Liga Después', true) returning id into cuLiga;
  insert into public.customers (full_name, active) values ('Se Liga Con Cartera', true) returning id into cuLiga2;
  cuCon := tests.cliente(d1);

  -- ══ 1 · Dirección asigna vendedor a un cliente SIN cuenta ══
  perform tests.act_as(v_admin);
  r := public.cliente_vendedor_asignar(cuSin, s1, null);
  perform tests.ok((r ->> 'por') = 'cliente' and not (r ->> 'idempotente')::boolean, '1 · asignado por cliente');
  perform tests.act_as_service();
  perform tests.ok((select seller_profile_id = s1 and asignado_por = v_admin from public.cc_cartera_clientes where customer_id = cuSin), '1 · queda en la cartera por cliente');
  perform tests.act_as(v_admin);
  perform tests.eq((public.cliente_vendedor_asignar(cuSin, s1, null) ->> 'idempotente')::boolean, true, '1 · repetir es idempotente');
  perform tests.throws(format('select public.cliente_vendedor_asignar(%L, %L, null)', cuSin, s2), 'MOTIVO_REQUERIDO', '1 · cambiar exige motivo');
  r := public.cliente_vendedor_asignar(cuSin, s2, 'Cambio de zona');
  perform tests.act_as_service();
  perform tests.eq((select seller_profile_id from public.cc_cartera_clientes where customer_id = cuSin), s2, '1 · cambiado con motivo');
  perform tests.eq((select count(*)::int from public.cc_cartera_clientes_historial where customer_id = cuSin), 2, '1 · historial de cada cambio');
  perform tests.eq((select count(*)::int from public.customer_events where customer_id = cuSin and tipo = 'vendedor_asignado'), 2, '1 · queda en la actividad del cliente');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cliente_vendedor_asignar(%L, %L, null)', cuSin, sNo), 'VENDEDOR_NO_ELEGIBLE', '1 · vendedor sin permisos de atención: rechazado');
  r := public.cliente_360(cuSin);
  perform tests.ok((r -> 'resumen' -> 'vendedor' ->> 'nombre') is not null and (r -> 'permisos' ->> 'cartera')::boolean and (r -> 'permisos' ->> 'estado')::boolean, '1 · la ficha muestra el vendedor y permite editarlo');
  perform tests.eq(jsonb_array_length(r -> 'comercial' -> 'historial'), 2, '1 · la ficha muestra el historial de asignación');
  perform tests.ok(exists (select 1 from jsonb_array_elements(r -> 'actividad') e where e ->> 'tipo' = 'cartera_reasignada'), '1 · y la actividad');

  -- ══ 2 · el vendedor asignado ve y atiende a su cliente sin cuenta; otro vendedor no ══
  perform tests.act_as(s2);
  perform tests.eq(public.cliente_360(cuSin) ->> 'rol', 'vendedor', '2 · el vendedor asignado abre la ficha');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_mi_cartera()) x where x ->> 'customer_id' = cuSin::text and x ->> 'profile_id' is null), '2 · aparece en "Mi cartera"');
  perform public.cliente_nota_agregar(cuSin, 'Le interesa el kit de inicio');
  perform tests.ok(jsonb_array_length(public.cliente_360(cuSin) -> 'contacto' -> 'notas') = 1, '2 · y puede trabajar con él (notas)');
  perform tests.throws(format('select public.cliente_vendedor_asignar(%L, %L, %L)', cuSin, s2, 'x'), 'NO_AUTORIZADO', '2 · el vendedor no se asigna clientes');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cliente_360(%L)', cuSin), 'NO_AUTORIZADO', '2 · el vendedor anterior ya no lo ve');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.cc_mi_cartera()) x where x ->> 'customer_id' = cuSin::text), '2 · ni en su cartera');
  perform tests.throws('select count(*) from public.cc_cartera_clientes', 'permission denied', '2 · la tabla no se lee directo');

  -- ══ 3 · cliente CON cuenta: es la cartera de la cuenta (comando canónico) ══
  perform tests.act_as(v_admin);
  r := public.cliente_vendedor_asignar(cuCon, s1, null);
  perform tests.act_as_service();
  perform tests.ok((r ->> 'por') = 'cuenta' and (select seller_profile_id = s1 from public.cc_cartera where profile_id = d1), '3 · con cuenta: cartera de la cuenta');
  perform tests.ok(not exists (select 1 from public.cc_cartera_clientes where customer_id = cuCon), '3 · sin duplicar en la cartera por cliente');
  perform tests.act_as(v_admin);
  perform tests.eq(public.cliente_360(cuCon) -> 'resumen' -> 'vendedor' ->> 'nombre', (select coalesce(meta ->> 'name', full_name, email) from public.profiles where id = s1), '3 · la ficha lo muestra');

  -- ══ 4 · al ligar la cuenta, el vendedor se hereda (o se respeta el de la cuenta) ══
  perform public.cliente_vendedor_asignar(cuLiga, s1, null);
  perform tests.act_as_service();
  update public.customers set profile_id = dNueva where id = cuLiga;
  perform tests.ok((select seller_profile_id = s1 from public.cc_cartera where profile_id = dNueva) and not exists (select 1 from public.cc_cartera_clientes where customer_id = cuLiga), '4 · la cuenta hereda el vendedor del cliente');
  perform tests.ok(exists (select 1 from public.cc_cartera_historial where profile_id = dNueva and seller_nuevo = s1), '4 · con su historial');
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d2, s2);
  perform tests.act_as(v_admin); perform public.cliente_vendedor_asignar(cuLiga2, s1, null); perform tests.act_as_service();
  update public.customers set profile_id = d2 where id = cuLiga2;
  perform tests.ok((select seller_profile_id = s2 from public.cc_cartera where profile_id = d2) and not exists (select 1 from public.cc_cartera_clientes where customer_id = cuLiga2), '4 · si la cuenta ya tenía vendedor, se respeta (sin dos verdades)');

  -- ══ 5 · baja y reactivación ══
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cliente_estado_guardar(%L, false, null)', cuSin2), 'MOTIVO_REQUERIDO', '5 · dar de baja exige motivo');
  r := public.cliente_estado_guardar(cuSin2, false, 'Cerró su consultorio');
  perform tests.act_as_service();
  perform tests.ok((select not active from public.customers where id = cuSin2) and exists (select 1 from public.customer_events where customer_id = cuSin2 and tipo = 'cliente_baja'), '5 · dado de baja, con constancia');
  perform tests.act_as(v_admin);
  perform tests.eq((public.cliente_estado_guardar(cuSin2, false, 'x') ->> 'idempotente')::boolean, true, '5 · idempotente');
  r := public.cliente_estado_guardar(cuSin2, true, null);
  perform tests.act_as_service();
  perform tests.ok((select active from public.customers where id = cuSin2) and exists (select 1 from public.customer_events where customer_id = cuSin2 and tipo = 'cliente_reactivado'), '5 · reactivado sin motivo obligatorio');
  perform tests.act_as(s2);
  perform tests.throws(format('select public.cliente_estado_guardar(%L, false, %L)', cuSin, 'x'), 'NO_AUTORIZADO', '5 · el vendedor no da de baja');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cliente_estado_guardar(%L, false, %L)', cuCon, 'x'), 'NO_AUTORIZADO', '5 · el doctor tampoco');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cliente_vendedor_asignar(%L, %L, null)', cuSin, s1), 'permission denied', '5 · anónimo no asigna');

  -- ══ 6 · conteos y coincidencias usan la cartera por cliente ══
  perform tests.act_as(v_admin);
  perform tests.eq((select (x ->> 'clientes')::int from jsonb_array_elements(public.cc_vendedores()) x where x ->> 'id' = s2::text), 2, '6 · "clientes" del vendedor cuenta ambas carteras (1 por cuenta + 1 por cliente)');
  perform tests.act_as_service();
  perform tests.eq(public._cc_prerregistro_coincidencia('sin@test.local', '0000000000') ->> 'seller', s2::text, '6 · el enlace de contacto rutea al vendedor del cliente sin cuenta');
end $t$;
rollback;
