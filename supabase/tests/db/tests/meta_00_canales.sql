-- CANALES DE META (170) · Instagram y Messenger entran a Conversaciones como WhatsApp: espejo registra; activo encola,
-- contesta y forma la salida; nada duplica; la ventana de 24 h; la bandeja de Dirección ve los tres canales; permisos.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); r jsonb; r2 jsonb; c uuid; c2 uuid; b jsonb; sal record; n int; d uuid; cw uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;

  -- 1 · espejo: entra, se ve con su canal, no se encola ni sale nada
  r := public.cc_meta_entrante('instagram', '17841400000000001', null, 'mid.IG0001', '¿Tienen bioestimuladores?', false);
  c := (r ->> 'conversation_id')::uuid;
  perform tests.ok(r ->> 'actor' = 'visitor' and not (r ->> 'duplicado')::boolean and (r ->> 'nuevo')::boolean and not (r ->> 'activo')::boolean
    and exists (select 1 from public.cc_messages where conversation_id = c and content = '¿Tienen bioestimuladores?' and actor_type = 'visitor' and client_message_id = public._cc_client_id_canal('meta', 'mid.IG0001')), '1 · Instagram entra como visitante interno');
  perform tests.eq(public._cc_nombre_dueno(c), 'Contacto (Instagram)', '1 · sin nombre todavía: "Contacto (Instagram)"');
  perform public.cc_meta_nombre('instagram', '17841400000000001', 'Ana IG');
  perform tests.eq(public._cc_nombre_dueno(c), 'Ana IG (Instagram)', '1 · con el nombre que consiguió la Edge');
  perform public.cc_meta_nombre('instagram', '17841400000000001', 'Otro');
  perform tests.eq(public._cc_nombre_dueno(c), 'Ana IG (Instagram)', '1 · el nombre no se pisa');
  perform tests.ok((select modo = 'ai_active' and seller_profile_id is null from public.cc_conversations where id = c), '1 · espejo: ni cola ni vendedor');
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:m1', 'Sí, tenemos.');
  perform tests.ok(not exists (select 1 from public.cc_meta_salida where conversation_id = c), '1 · en espejo nada se forma para salir');

  -- 2 · reintento de Meta y segundo mensaje
  r2 := public.cc_meta_entrante('instagram', '17841400000000001', null, 'mid.IG0001', '¿Tienen bioestimuladores?', false);
  perform tests.ok((r2 ->> 'duplicado')::boolean and (select count(*) from public.cc_messages where conversation_id = c and actor_type = 'visitor') = 1, '2 · el mismo mid no duplica');
  r2 := public.cc_meta_entrante('instagram', '17841400000000001', null, 'mid.IG0002', '¿Precio?', false);
  perform tests.ok((r2 ->> 'conversation_id')::uuid = c and not (r2 ->> 'nuevo')::boolean, '2 · otro mensaje del mismo contacto, misma conversación');

  -- 3 · Messenger es otro contacto aunque el PSID coincida en número
  r := public.cc_meta_entrante('messenger', '17841400000000001', 'Beto FB', 'mid.FB0001', 'Hola por Facebook', false);
  c2 := (r ->> 'conversation_id')::uuid;
  perform tests.ok(c2 <> c and public._cc_nombre_dueno(c2) = 'Beto FB (Facebook)', '3 · Messenger: contacto y conversación propios');
  perform tests.throws('select public.cc_meta_entrante(''tiktok'', ''123456'', null, ''mid.X0001'', ''hola'', false)', 'META_DATOS_INVALIDOS', '3 · canal desconocido se rechaza');

  -- 4 · canal de la conversación (para el chat del personal) y bandeja de Dirección con los tres canales
  perform tests.ok(public.cc_canal_conversacion(c) ->> 'canal' = 'instagram' and public.cc_canal_conversacion(c) ->> 'modo' = 'espejo' and (public.cc_canal_conversacion(c) ->> 'ventana_abierta')::boolean, '4 · la conversación sabe que es de Instagram');
  r := public.cc_wa_entrante('5216671230009', 'Wa Persona', 'wamid.M0001', 'Hola por WhatsApp', false);
  cw := (r ->> 'conversation_id')::uuid;
  perform tests.ok(public.cc_canal_conversacion(cw) ->> 'canal' = 'whatsapp' and public.cc_canal_conversacion(cw) ->> 'wa_id' = '5216671230009', '4 · una de WhatsApp sigue diciendo WhatsApp (con wa_id)');
  d := tests.user('doctor', 'web-doc@t.local');
  perform tests.ok(public.cc_canal_conversacion((public.cc_abrir_conversacion(null, d) ->> 'conversation_id')::uuid) is null, '4 · el chat web no es de ningún canal');
  perform tests.act_as(v_admin);
  b := public.cc_canales_bandeja();
  perform tests.ok(b -> 'modos' ->> 'whatsapp' = 'espejo' and b -> 'modos' ->> 'instagram' = 'espejo' and b -> 'modos' ->> 'messenger' = 'espejo' and jsonb_array_length(b -> 'chats') = 3
    and (select count(*) from jsonb_array_elements(b -> 'chats') x where x ->> 'canal' = 'instagram' and x ->> 'nombre' = 'Ana IG' and (x ->> 'n_mensajes')::int = 2 and x ->> 'ultimo_texto' = '¿Precio?') = 1
    and (select count(*) from jsonb_array_elements(b -> 'chats') x where x ->> 'canal' = 'whatsapp' and x ->> 'id' = '5216671230009') = 1
    and (select count(*) from jsonb_array_elements(b -> 'chats') x where x ->> 'canal' = 'messenger' and (x ->> 'sin_responder')::boolean) = 1, '4 · Dirección ve los tres canales con su último mensaje');

  -- 5 · activo (solo Instagram): entra a la cola humana, la IA contesta y sale por Instagram; Messenger sigue en espejo
  perform tests.act_as_owner(); update public.cc_meta_config set modo = 'activo' where canal = 'instagram'; perform tests.act_as_service();
  r := public.cc_meta_entrante('instagram', '17841400000000001', null, 'mid.IG0003', '¿Envían a Mazatlán?', false);
  perform tests.ok((r ->> 'activo')::boolean and (select modo in ('human_requested', 'human_assigned') from public.cc_conversations where id = c), '5 · activo: entra a la cola humana');
  perform tests.ok(exists (select 1 from public.cc_messages m where m.conversation_id = c and m.actor_type = 'system' and m.client_message_id like 'sys:instagram:%'), '5 · el aviso de handoff lleva el origen del canal');
  perform tests.act_as_owner(); update public.cc_meta_config set ia_habilitada = true where canal = 'instagram'; perform tests.act_as_service();   -- R4-B2-3b: la IA solo sale con su canal encendido
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:m2', 'Sí, enviamos a todo México.');
  perform tests.ok(exists (select 1 from public.cc_meta_salida where conversation_id = c and canal = 'instagram' and psid = '17841400000000001' and texto = 'Sí, enviamos a todo México.' and estado = 'pendiente'), '5 · la respuesta se forma para Instagram');
  perform public.cc_enviar_mensaje(c2, 'ai', null, null, 'ai:m3', 'Hola Beto');
  perform tests.ok(not exists (select 1 from public.cc_meta_salida where conversation_id = c2), '5 · Messenger sigue en espejo: nada sale');
  perform public._cc_sistema(c, 'Aviso', 'sys:prueba');
  perform tests.ok((select count(*) from public.cc_meta_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c and m.actor_type <> 'system') = 1, '5 · lo del cliente no sale (solo la respuesta de la IA)');
  perform tests.ok((select count(*) = 1 and bool_and(m.client_message_id like 'sys:instagram:%') from public.cc_meta_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c and m.actor_type = 'system'), '5 · R4-B2-2: de los avisos del sistema solo sale el de la transferencia (sys:instagram:)');

  -- 6 · reclamar / resolver sin dobles; fuera de 24 h; fallo con reintento
  select count(*) into n from public.cc_meta_salida_reclamar(10);
  perform tests.ok(n = 2 and (select count(*) from public.cc_meta_salida_reclamar(10)) = 0, '6 · un envío se reclama una sola vez (respuesta de la IA + aviso de transferencia, R4-B2-2)');
  perform public.cc_meta_salida_resolver((select s.id from public.cc_meta_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c and m.actor_type = 'system'), true, 'mid.OUT0000', null);
  select * into sal from public.cc_meta_salida where conversation_id = c and texto = 'Sí, enviamos a todo México.';
  perform public.cc_meta_salida_resolver(sal.id, true, 'mid.OUT0001', null);
  perform tests.ok((select estado = 'enviado' and mid = 'mid.OUT0001' from public.cc_meta_salida where id = sal.id) and exists (select 1 from public.cc_meta_mensajes where mid = 'mid.OUT0001' and direccion = 'out'), '6 · enviado con su mid');
  perform tests.act_as_owner(); update public.cc_meta_contactos set ultimo_entrante_at = now() - interval '25 hours' where psid = '17841400000000001' and canal = 'instagram'; perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:m4', '¿Sigues ahí?');
  perform tests.ok(exists (select 1 from public.cc_meta_salida where conversation_id = c and texto = '¿Sigues ahí?' and estado = 'fuera_ventana') and (public.cc_canal_conversacion(c) ->> 'ventana_abierta')::boolean = false and (public.cc_canal_conversacion(c) ->> 'fallidos')::int = 1, '6 · después de 24 h no se manda (y la pantalla lo sabe)');
  perform tests.act_as_owner(); update public.cc_meta_contactos set ultimo_entrante_at = now() where psid = '17841400000000001' and canal = 'instagram'; perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:m5', 'Te paso el catálogo.');
  select * into sal from public.cc_meta_salida_reclamar(10) limit 1;
  perform public.cc_meta_salida_resolver(sal.id, false, null, 'Meta 429: límite');
  perform tests.ok((select estado = 'pendiente' and error = 'Meta 429: límite' from public.cc_meta_salida where id = sal.id), '6 · si Meta lo rechaza por cupo, vuelve a la cola (R4-B2-2: un 5xx quedaría incierto)');

  -- 7 · permisos: solo el servidor opera; Dirección solo lee la bandeja
  perform tests.act_as(s1);
  perform tests.throws('select public.cc_canales_bandeja()', 'NO_AUTORIZADO', '7 · Ventas no ve la bandeja de canales');
  perform tests.throws('select public.cc_meta_entrante(''instagram'', ''17841400000000001'', null, ''mid.IG0009'', ''x'', false)', 'permission denied', '7 · un usuario no puede meter mensajes');
  perform tests.act_as(v_admin);
  perform tests.throws('select public.cc_canal_conversacion(''' || c || ''')', 'permission denied', '7 · el canal de la conversación lo consulta el servidor');
  perform tests.act_as_anon();
  perform tests.throws('select public.cc_canales_bandeja()', 'permission denied', '7 · anónimo: nada');
  perform tests.act_as_owner();
end $t$;
rollback;
