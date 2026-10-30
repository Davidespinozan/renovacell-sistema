-- HERRAMIENTAS DEL VENDEDOR · bloque C (20270216) · seguimientos: en qué quedó con un cliente y cuándo retomarlo; uno
-- vigente por cliente y vendedor; solo quien lo atiende; la alerta llega el día que toca (desde las 9:00 de Culiacán).
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); d1 uuid := tests.user('doctor');
  cu1 uuid; cuOtro uuid; r jsonb; id1 uuid; n int; hoy date;
begin
  perform tests.act_as_service();
  hoy := public.hoy_local();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  cu1 := tests.cliente(d1); update public.customers set full_name = 'Ana Pérez' where id = cu1;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  insert into public.customers (full_name, active) values ('Cliente De Otro', true) returning id into cuOtro;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cuOtro, s2);

  -- ══ 1 · dejar un seguimiento ══
  perform tests.act_as(s1);
  r := public.seguimiento_guardar(cu1, null, 'esperando_pago', 'Quedó de transferir el viernes', hoy + 3);
  id1 := (r ->> 'id')::uuid;
  perform tests.ok(r ->> 'nombre' = 'Ana Pérez' and r ->> 'estado' = 'esperando_pago' and (r ->> 'recordar_el')::date = hoy + 3 and (r ->> 'es_mio')::boolean, '1 · queda con su estado, nota y fecha');
  perform tests.eq(public.seguimiento_de(cu1, null) ->> 'id', id1::text, '1 · es el vigente de ese cliente');
  r := public.seguimiento_guardar(cu1, null, 'lo_esta_pensando', null, hoy + 7);
  perform tests.eq(public.seguimiento_de(cu1, null) ->> 'estado', 'lo_esta_pensando', '1 · el vigente es el nuevo');
  perform tests.act_as_owner();
  perform tests.ok((select hecho_at is not null from public.cc_seguimientos where id = id1), '1 · el nuevo cierra el anterior (uno vigente)');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.seguimiento_guardar(%L, null, %L, null, %L)', cu1, 'otro', hoy - 1), 'DATO_INVALIDO:fecha', '1 · no a una fecha pasada');
  perform tests.throws(format('select public.seguimiento_guardar(%L, null, %L, null, %L)', cu1, 'inventado', hoy), 'ck_seg_estado', '1 · solo estados conocidos');
  perform tests.throws(format('select public.seguimiento_guardar(%L, null, %L, null, %L)', cuOtro, 'otro', hoy), 'NO_AUTORIZADO', '1 · no a clientes de otro vendedor');

  -- ══ 2 · mi lista; posponer y marcar hecho ══
  r := public.mis_seguimientos();
  perform tests.ok(jsonb_array_length(r -> 'seguimientos') = 1 and (r ->> 'hoy')::date = hoy, '2 · mi lista: 1 vigente');
  id1 := (r -> 'seguimientos' -> 0 ->> 'id')::uuid;
  perform tests.eq((public.seguimiento_actualizar(id1, false, hoy + 1) ->> 'recordar_el')::date, hoy + 1, '2 · posponer');
  perform tests.act_as(s2);
  perform tests.throws(format('select public.seguimiento_actualizar(%L, true, null)', id1), 'NO_AUTORIZADO', '2 · otro vendedor no lo toca');
  perform tests.eq(jsonb_array_length(public.mis_seguimientos() -> 'seguimientos'), 0, '2 · ni lo ve');
  perform tests.act_as(v_admin);
  perform tests.ok((public.mis_seguimientos() -> 'seguimientos' -> 0 ->> 'vendedor') is not null, '2 · Dirección ve los de todos, con su vendedor');

  -- ══ 3 · la alerta el día que toca ══
  perform tests.act_as_owner();
  update public.cc_seguimientos set recordar_el = hoy where id = id1;
  perform tests.act_as_service();
  n := public.cc_seguimientos_avisar();
  if extract(hour from (now() at time zone 'America/Mazatlan')) >= 9 then
    perform tests.ok(n = 1 and exists (select 1 from public.notifications where kind = 'seguimiento' and user_ids = array[s1] and body like 'Hoy toca retomar a Ana Pérez%'), '3 · alerta al vendedor el día que toca');
    perform tests.eq(public.cc_seguimientos_avisar(), 0, '3 · una sola vez por día');
  else
    perform tests.eq(n, 0, '3 · antes de las 9:00 no avisa');
    perform tests.ok(true, '3 · (la alerta se probará después de las 9:00)');
  end if;
  perform tests.act_as(s1);
  r := public.seguimiento_actualizar(id1, true, null);
  perform tests.ok((r ->> 'hecho')::boolean and public.seguimiento_de(cu1, null) is null, '3 · hecho: ya no está vigente (' || r::text || ' / ' || coalesce(public.seguimiento_de(cu1, null)::text, 'null') || ')');

  -- ══ 4 · permisos ══
  perform tests.act_as(d1);
  perform tests.throws('select public.mis_seguimientos()', 'NO_AUTORIZADO', '4 · un doctor no');
  perform tests.act_as(s1);
  perform tests.throws('select count(*) from public.cc_seguimientos', 'permission denied', '4 · la tabla no se lee directo');
  perform tests.throws('select public.cc_seguimientos_avisar()', 'permission denied', '4 · el cron no lo corre un vendedor');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from cron.job where jobname = 'renovacell-seguimientos' and active) = 1, '4 · cron cada 15 minutos');
end $t$;
rollback;
