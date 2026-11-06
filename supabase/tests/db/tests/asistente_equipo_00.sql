-- ASISTENTE DEL EQUIPO · las consultas respetan el rol: Dirección ve todo; Ventas solo lo suyo/su cartera; Almacén solo la
-- logística del pedido (sin montos); un doctor nada. La bitácora solo la lee Dirección.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); alm uuid := tests.user('warehouse'); d uuid := tests.user('doctor');
  c1 uuid; cu uuid; o uuid; r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}', full_name = 'Vendedor Uno' where id = s1;
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}', full_name = 'Vendedor Dos' where id = s2;
  c1 := (public.cc_wa_entrante('5216671420666', 'Emanuel F', 'wamid.EQ00000001', 'Buena tarde, ¿dónde entrego?', false) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  insert into public.customers (full_name, phone) values ('Maria Jose Prueba', '+52 687 160 5335') returning id into cu;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cu, s1);
  update public.cc_conversations set seller_profile_id = s2 where id = c1;
  insert into public.orders (external_ref, customer_id, total, status, payment_method, payment_status) values ('SEQ1', cu, 1500, 'pending_payment', 'transferencia', 'pending') returning id into o;

  -- 1 · conversaciones
  perform tests.act_as(v_admin);
  r := public.ia_eq_conversaciones('Emanuel');
  perform tests.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'contacto' = 'Emanuel F' and r -> 0 ->> 'atiende_ahora' = 'Vendedor Dos'
                   and r -> 0 -> 'mensajes' -> 0 ->> 'texto' = 'Buena tarde, ¿dónde entrego?', '1 · Dirección la encuentra por nombre, con quién la atiende y sus mensajes');
  perform tests.ok(jsonb_array_length(public.ia_eq_conversaciones('667 142 0666')) = 1, '1 · y por número');
  perform tests.act_as(s2);
  perform tests.ok(jsonb_array_length(public.ia_eq_conversaciones('Emanuel')) = 1, '1 · el vendedor que la tiene la ve');
  perform tests.act_as(s1);
  perform tests.ok(jsonb_array_length(public.ia_eq_conversaciones('Emanuel')) = 0, '1 · otro vendedor no la ve');
  perform tests.throws('select public.ia_eq_conversaciones(''Em'')', 'BUSQUEDA_CORTA', '1 · búsqueda muy corta');
  perform tests.act_as(alm);
  perform tests.throws('select public.ia_eq_conversaciones(''Emanuel'')', 'NO_AUTORIZADO', '1 · Almacén no consulta conversaciones');
  perform tests.act_as(d);
  perform tests.throws('select public.ia_eq_conversaciones(''Emanuel'')', 'NO_AUTORIZADO', '1 · un doctor tampoco');

  -- 2 · pedido
  perform tests.act_as(v_admin);
  r := public.ia_eq_pedido('seq1');
  perform tests.ok((r ->> 'encontrado')::boolean and r ->> 'cliente' = 'Maria Jose Prueba' and (r -> 'pago' ->> 'total')::numeric = 1500, '2 · Dirección ve el pedido con montos (folio sin importar mayúsculas)');
  perform tests.act_as(s1);
  perform tests.ok((public.ia_eq_pedido('SEQ1') -> 'pago') is not null, '2 · su vendedor ve montos');
  perform tests.act_as(s2);
  perform tests.throws('select public.ia_eq_pedido(''SEQ1'')', 'NO_AUTORIZADO', '2 · otro vendedor no');
  perform tests.act_as(alm);
  r := public.ia_eq_pedido('SEQ1');
  perform tests.ok((r ->> 'encontrado')::boolean and r -> 'pago' = 'null'::jsonb and r ->> 'estado' = 'pending_payment', '2 · Almacén ve estado y envío, sin montos');
  perform tests.ok(not (public.ia_eq_pedido('NOEXISTE') ->> 'encontrado')::boolean, '2 · folio inexistente');
  perform tests.act_as(d);
  perform tests.throws('select public.ia_eq_pedido(''SEQ1'')', 'NO_AUTORIZADO', '2 · un doctor no');

  -- 3 · bitácora: solo Dirección la lee; nadie la escribe desde la app
  perform tests.act_as_owner();
  insert into public.ia_eq_consultas (profile_id, rol, pregunta) values (s1, 'pos', '¿De quién es cliente?');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.ia_eq_consultas), 1, '3 · Dirección lee la bitácora');
  perform tests.act_as(s1);
  perform tests.eq((select count(*)::int from public.ia_eq_consultas), 0, '3 · Ventas no la lee');
  perform tests.throws(format('insert into public.ia_eq_consultas (profile_id, pregunta) values (%L, ''x'')', s1), 'permission denied', '3 · ni la escribe');
  perform tests.act_as_owner();
end $t$;
rollback;
