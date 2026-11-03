-- CARTERA-PLAZO (20270327) · quien atiende a alguien sin vendedor se lo queda 180 días (cuenta, ficha o prospecto de
-- WhatsApp); cada pedido pagado reinicia el plazo; cada mes sin compra y 7 días antes se le avisa; al vencer se libera y
-- vuelve al reparto. Gana la cartera. Tablero de competencia por vendedor.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sJ uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor');
  c1 uuid; c2 uuid; cw uuid; vw uuid; cu uuid; o uuid; r jsonb; n int; t timestamptz;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","jefe_ventas"]}' where id = sJ;
  perform tests.act_as_owner();
  update public.cc_wa_config set modo = 'activo', ia_habilitada = true where id;
  perform tests.eq(public._cc_cartera_plazo(), 180, '0 · plazo de 6 meses');
  perform tests.act_as_service();

  -- ══ 1 · atiende a un doctor sin vendedor: se lo queda ══
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  perform public._cc_handler_asignar(c1, s1, 'system', null, 'prueba', 'direccion');
  perform public.cc_iniciar_asesoria(c1, s1);
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = s1 and plazo_desde > now() - interval '1 minute' from public.cc_cartera where profile_id = d1), '1 · el doctor queda en su cartera con el reloj desde hoy');
  perform tests.ok(exists (select 1 from public.cc_cartera_eventos where seller_profile_id = s1 and tipo = 'asignado' and profile_id = d1), '1 · queda el evento "asignado"');
  -- Gana la cartera: si ya tiene vendedor, atenderlo no lo cambia.
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d2, s2);
  perform tests.act_as_service();
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform public._cc_handler_asignar(c2, s1, 'system', null, 'prueba', 'direccion');
  perform public.cc_iniciar_asesoria(c2, s1);
  perform tests.act_as_owner();
  perform tests.eq((select seller_profile_id from public.cc_cartera where profile_id = d2), s2, '1 · el cliente de la cartera de otro no cambia de dueño');

  -- ══ 2 · prospecto de WhatsApp: se lo queda y lo que escriba le llega a él ══
  perform tests.act_as_service();
  cw := (public.cc_wa_entrante('5216670000088', 'Yara', 'wamid.CP.1', 'Hola, ¿precio de Nabota?', false) ->> 'conversation_id')::uuid;
  select visitor_id into vw from public.cc_conversations where id = cw;
  perform public._cc_handler_asignar(cw, s1, 'system', null, 'reparto', 'reparto');
  perform public.cc_iniciar_asesoria(cw, s1);
  perform tests.act_as_owner();
  perform tests.eq((select seller_profile_id from public.cc_cartera_prospectos where visitor_id = vw), s1, '2 · el prospecto queda en su cartera');
  perform tests.eq(public._cc_vendedor_conv(cw), s1, '2 · y es su responsable');
  -- La asesoría se cierra (inactividad) y el prospecto vuelve a pedir asesor días después: le toca a SU vendedor, no al reparto.
  update public.cc_conversations set modo = 'ai_active', seller_profile_id = null where id = cw;
  perform tests.act_as_service();
  perform public.cc_solicitar_asesor(cw, 'visitor', (select visitor_hash from public.cc_wa_contactos where wa_id = '5216670000088'), null);
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = s1 and modo = 'human_assigned' from public.cc_conversations where id = cw), '2 · vuelve a pedir asesor: va directo a su vendedor');
  perform tests.eq(public._cc_responsable_comercial(cw), s1, '2 · y los avisos de "el cliente escribe" le llegan a él');
  perform tests.act_as(s1);
  perform tests.ok((select (e ->> 'dias_restantes')::int between 179 and 180 from jsonb_array_elements(public.cc_mis_conversaciones()) e where e ->> 'conversation_id' = cw::text)
                   or exists (select 1 from public.cc_cola_asesorias() q where q.conversation_id = cw), '2 · en su lista, con los días que le quedan');

  -- ══ 3 · el prospecto se liga a su ficha: vendedor y plazo pasan con él ══
  perform tests.act_as_owner();
  update public.cc_cartera_prospectos set plazo_desde = now() - interval '40 days' where visitor_id = vw;
  insert into public.customers (full_name, active) values ('Yara Clínica', true) returning id into cu;
  update public.cc_conversations set customer_id = cu where id = cw;
  perform tests.ok((select seller_profile_id = s1 and plazo_desde < now() - interval '39 days' from public.cc_cartera_clientes where customer_id = cu)
                   and not exists (select 1 from public.cc_cartera_prospectos where visitor_id = vw), '3 · pasa a la cartera de su ficha con el mismo plazo');

  -- ══ 4 · un pedido PAGADO reinicia el plazo; uno sin pagar no ══
  update public.cc_cartera set plazo_desde = now() - interval '100 days' where profile_id = d1;
  perform tests.act_as_service();
  o := tests.order(d1, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', tests.product(), 'qty', 1)), 'pending');
  perform tests.act_as_owner();
  perform tests.ok((select plazo_desde < now() - interval '99 days' from public.cc_cartera where profile_id = d1), '4 · sin pagar: el plazo no cambia');
  perform set_config('app.trusted', 'on', true);
  update public.orders set payment_status = 'paid', status = 'paid' where id = o;
  perform set_config('app.trusted', '', true);
  perform tests.ok((select plazo_desde > now() - interval '1 minute' from public.cc_cartera where profile_id = d1), '4 · pagado: el reloj vuelve a empezar');
  perform tests.ok(exists (select 1 from public.cc_cartera_eventos where seller_profile_id = s1 and tipo = 'renovado' and dias_sin_compra = 100), '4 · cuenta como cliente rescatado (100 días sin compra)');

  -- ══ 5 · avisos: cada mes sin compra y 7 días antes; al vencer se libera ══
  update public.cc_cartera set plazo_desde = now() - interval '30 days' - interval '2 hours' where profile_id = d1;
  update public.cc_cartera_clientes set plazo_desde = now() - interval '173 days' - interval '2 hours' where customer_id = cu;
  delete from public.notifications where kind = 'cartera_plazo';
  r := public.cc_cartera_plazos_job();
  perform tests.ok((select count(*) = 1 from public.notifications where kind = 'cartera_plazo' and user_ids = array[s1]
                    and body like '%Yara Clínica pasa a otro vendedor en 7 días%' and body like '%1 cliente cumple otro mes sin comprar (al más cercano le quedan 150 días)%'), '5 · un solo aviso al vendedor con los dos casos');
  perform tests.eq((public.cc_cartera_plazos_job() ->> 'avisos')::int, 1, '5 · el mismo día no se repite (aviso idempotente)');
  perform tests.eq((select count(*)::int from public.notifications where kind = 'cartera_plazo' and user_ids = array[s1]), 1, '5 · sigue siendo uno');
  update public.cc_cartera_clientes set plazo_desde = now() - interval '181 days' where customer_id = cu;
  r := public.cc_cartera_plazos_job();
  perform tests.ok((r ->> 'liberados')::int = 1 and not exists (select 1 from public.cc_cartera_clientes where customer_id = cu), '5 · vencido: sale de su cartera');
  perform tests.ok(exists (select 1 from public.cc_cartera_clientes_historial where customer_id = cu and seller_anterior = s1 and motivo like 'Venció: 180 días%')
                   and exists (select 1 from public.cc_cartera_eventos where seller_profile_id = s1 and tipo = 'liberado' and customer_id = cu), '5 · con historial y evento');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'cartera_plazo' and user_ids = array[s1] and body like '1 cliente salió de tu cartera%'), '5 · y se le avisa');
  perform tests.ok(public._cc_vendedor_conv(cw) is null, '5 · ya no tiene responsable: la próxima vez entra al reparto');

  -- ══ 6 · plazos y tablero ══
  perform tests.act_as(s1);
  r := public.cc_cartera_plazos(null, 730);
  perform tests.ok((r ->> 'plazo_dias')::int = 180 and exists (select 1 from jsonb_array_elements(r -> 'clientes') e where e ->> 'profile_id' = d1::text and (e ->> 'dias_restantes')::int = 150 and e -> 'vendedor' = 'null'::jsonb), '6 · el vendedor ve su cartera con días restantes (' || r::text || ')');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r -> 'clientes') e where e ->> 'profile_id' = d2::text), '6 · y no la de otros');
  perform tests.eq(jsonb_array_length(public.cc_cartera_plazos(null, 30) -> 'clientes'), 0, '6 · "por vencer en 30 días": ninguno');
  perform tests.act_as(sJ);
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_cartera_plazos(null, 730) -> 'clientes') e where e ->> 'profile_id' = d2::text and e ->> 'vendedor' is not null), '6 · el jefe de ventas ve todas, con su vendedor');
  perform tests.act_as(s2);
  r := public.cc_cartera_ranking();
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) e where (e ->> 'compraron_mes')::int = 1 and (e ->> 'rescatados_mes')::int = 1 and (e ->> 'perdidos_mes')::int = 1 and not (e ->> 'soy_yo')::boolean)
                   and exists (select 1 from jsonb_array_elements(r) e where (e ->> 'soy_yo')::boolean and (e ->> 'en_cartera')::int = 1), '6 · tablero: cada vendedor con lo suyo, sin datos de clientes (' || r::text || ')');

  -- ══ 7 · permisos ══
  perform tests.act_as(d1);
  perform tests.throws('select public.cc_cartera_plazos()', 'NO_AUTORIZADO', '7 · un doctor no');
  perform tests.throws('select public.cc_cartera_ranking()', 'NO_AUTORIZADO', '7 · ni el tablero');
  perform tests.throws('select public.cc_cartera_plazos_job()', 'permission denied', '7 · el proceso diario es solo del servidor');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from cron.job where jobname = 'renovacell-cartera-plazos' and active and schedule = '10 15 * * *'), '7 · corre cada mañana');
end $t$;
rollback;
