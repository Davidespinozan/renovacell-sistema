-- MIS CLIENTES Y PROSPECTOS (20270325) · la conversación que atendí o que es de mi cartera no desaparece de mi lista
-- cuando vuelve a la IA, y la retomo yo misma (asignar + iniciar en un paso). Gana la cartera; no le quito a otro una
-- asesoría en curso; nadie más la ve ni la retoma.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor');
  c1 uuid; c2 uuid; c3 uuid; cu uuid; r jsonb; x jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'c:a1', 'Hola, ¿me cotizas 3 Nabota?');
  perform public.cc_enviar_mensaje(c2, 'doctor', null, d2, 'c:b1', 'Buen día');
  -- Las dos las atendió s1 y su asesoría se cerró por inactividad: volvieron a la IA sin vendedor.
  perform tests.act_as_owner();
  update public.cc_conversations set ultimo_asesor_id = s1, seller_profile_id = null, modo = 'ai_active' where id in (c1, c2);

  -- ══ 1 · siguen en MI lista aunque las atienda la IA ══
  perform tests.act_as(s1);
  r := public.cc_mis_conversaciones();
  x := (select e from jsonb_array_elements(r) e where e ->> 'conversation_id' = c1::text);
  perform tests.ok(jsonb_array_length(r) = 2 and x ->> 'atiende' = 'ia' and (x ->> 'puede_retomar')::boolean and x -> 'ultimo' ->> 'texto' = 'Hola, ¿me cotizas 3 Nabota?', '1 · la vendedora ve sus dos conversaciones, quién las atiende y el último mensaje (' || coalesce(x::text, r::text) || ')');
  perform tests.ok(x ->> 'prospecto' = 'false', '1 · un doctor con cuenta no es prospecto');
  -- Un prospecto que entra por WhatsApp (sin cuenta ni ficha) y que ella atendió.
  perform tests.act_as_service();
  c3 := (public.cc_wa_entrante('5216670000077', 'Yara', 'wamid.MC.1', 'Hola, ¿precio de Nabota?', false) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversations set ultimo_asesor_id = s1, seller_profile_id = null, modo = 'ai_active' where id = c3;
  perform tests.act_as(s1);
  perform tests.eq((select e ->> 'prospecto' from jsonb_array_elements(public.cc_mis_conversaciones()) e where e ->> 'conversation_id' = c3::text), 'true', '1 · sin cuenta y sin ficha: prospecto');
  perform tests.eq((select e ->> 'canal' from jsonb_array_elements(public.cc_mis_conversaciones()) e where e ->> 'conversation_id' = c3::text), 'whatsapp', '1 · y se sabe que escribe por WhatsApp');
  perform tests.act_as_owner();
  insert into public.customers (full_name, active) values ('Yara Ficha', true) returning id into cu;
  update public.cc_conversations set customer_id = cu where id = c3;
  perform tests.act_as(s1);
  perform tests.eq((select e ->> 'prospecto' from jsonb_array_elements(public.cc_mis_conversaciones()) e where e ->> 'conversation_id' = c3::text), 'false', '1 · con ficha de cliente (sin cuenta): cliente, no prospecto');
  perform tests.act_as_owner();
  update public.cc_conversations set estado = 'cerrada', closed_at = now() where id = c3;
  perform tests.act_as(s2);
  perform tests.eq(public.cc_mis_conversaciones(), '[]'::jsonb, '1 · otro vendedor no las ve');

  -- ══ 2 · gana la cartera ══
  perform tests.act_as_owner();
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d2, s2);
  perform tests.act_as(s1);
  perform tests.ok(jsonb_array_length(public.cc_mis_conversaciones()) = 1, '2 · el cliente de la cartera de otro ya no es mío aunque lo haya atendido');
  perform tests.throws(format('select public.cc_retomar_conversacion(%L)', c2), 'NO_AUTORIZADO', '2 · y no lo retomo');
  perform tests.act_as(s2);
  perform tests.eq(public.cc_mis_conversaciones() -> 0 ->> 'conversation_id', c2::text, '2 · lo ve su vendedor de cartera');

  -- ══ 3 · retomar: asignada e iniciada en un paso, sin aviso a sí misma ══
  perform tests.act_as(s1);
  r := public.cc_retomar_conversacion(c1);
  perform tests.ok(r ->> 'modo' = 'human_active' and not (r ->> 'idempotente')::boolean, '3 · retomada: asesoría activa');
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = s1 and modo = 'human_active' from public.cc_conversations where id = c1), '3 · queda a su nombre');
  perform tests.ok(not exists (select 1 from public.notifications where kind = 'handoff_asignado' and conversation_id = c1), '3 · no se avisa a sí misma "Solicitud de asesor"');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c1 and actor_type = 'system' and content like '%se unió a la conversación.'), '3 · el cliente ve que su asesora se unió');
  perform tests.act_as(s1);
  perform tests.ok(exists (select 1 from public.cc_cola_asesorias() q where q.conversation_id = c1 and q.es_mia and q.iniciada), '3 · ahora está en sus asesorías…');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.cc_mis_conversaciones()) e where e ->> 'conversation_id' = c1::text), '3 · …y no se repite en "mis clientes"');
  perform tests.ok((public.cc_retomar_conversacion(c1) ->> 'idempotente')::boolean, '3 · retomar otra vez: no pasa nada');
  perform tests.act_as_service();   -- el mensaje lo manda la Edge con la identidad de la vendedora
  perform tests.ok(public.cc_enviar_mensaje(c1, 'seller', null, s1, 'c:s1', 'Claro, te la preparo') ->> 'id' is not null, '3 · y ya puede escribir');

  -- ══ 4 · no se le quita a otro una asesoría en curso ══
  perform tests.act_as_owner();
  delete from public.cc_cartera where profile_id = d2;
  update public.cc_conversations set ultimo_asesor_id = s1, seller_profile_id = s2, modo = 'human_active' where id = c2;
  perform tests.act_as(s1);
  x := (select e from jsonb_array_elements(public.cc_mis_conversaciones()) e where e ->> 'conversation_id' = c2::text);
  perform tests.ok(x ->> 'atiende' = 'otro' and x ->> 'atiende_nombre' is not null and not (x ->> 'puede_retomar')::boolean, '4 · la ve: la atiende otra persona y no se puede retomar (' || coalesce(x::text, '') || ')');
  perform tests.throws(format('select public.cc_retomar_conversacion(%L)', c2), 'ATENDIDA_POR_OTRO', '4 · retomar: rechazado con el motivo');
  perform tests.act_as_owner();
  update public.cc_conversations set seller_profile_id = null, modo = 'ai_active', estado = 'cerrada', closed_at = now() where id = c2;
  perform tests.act_as(s1);
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.cc_mis_conversaciones()) e where e ->> 'conversation_id' = c2::text), '4 · cerrada: ya no aparece');

  -- ══ 5 · permisos ══
  perform tests.act_as(d1);
  perform tests.throws('select public.cc_mis_conversaciones()', 'NO_AUTORIZADO', '5 · un doctor no');
  perform tests.throws(format('select public.cc_retomar_conversacion(%L)', c1), 'NO_AUTORIZADO', '5 · ni retoma');
  perform tests.act_as_anon();
  perform tests.throws('select public.cc_mis_conversaciones()', 'permission denied', '5 · anónimo no');
  perform tests.act_as(s1);
  perform tests.throws(format('select public._cc_vendedor_conv(%L)', c1), 'permission denied', '5 · el auxiliar es solo del servidor');
end $t$;
rollback;
