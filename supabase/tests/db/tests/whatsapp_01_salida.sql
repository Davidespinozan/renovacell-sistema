-- WHATSAPP DE IDA Y VUELTA (168) · en modo activo lo que contestan la IA, la vendedora o Dirección sale por WhatsApp
-- (cola sin dobles), fuera de 24 h no se manda, el acuse "read" pone palomitas azules y en espejo no sale nada.
begin;
do $t$
declare s1 uuid := tests.user('pos'); d uuid; r jsonb; c uuid; c_web uuid; v_hash text; x record; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;

  -- espejo: entra pero nada sale
  r := public.cc_wa_entrante('5216671239999', 'Luis', 'wamid.S0001', 'Hola', false);
  c := (r ->> 'conversation_id')::uuid; v_hash := r ->> 'visitor_hash';
  perform tests.ok(v_hash ~ '^[0-9a-f]{64}$' and not (r ->> 'activo')::boolean, '0 · espejo: entra y devuelve lo que la IA necesitaría');
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:1', 'Hola Luis, ¿en qué te ayudo?');
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where conversation_id = c), '0 · en espejo no se forma nada para WhatsApp');

  -- activo
  perform tests.act_as_owner(); update public.cc_wa_config set modo = 'activo'; perform tests.act_as_service();
  r := public.cc_wa_entrante('5216671239999', 'Luis', 'wamid.S0002', '¿Tienen envío a Mazatlán?', false);
  perform tests.ok((r ->> 'activo')::boolean and (select modo in ('human_requested', 'human_assigned') from public.cc_conversations where id = c), '1 · activo: entra a la cola humana');
  perform tests.act_as_owner(); update public.cc_wa_config set ia_habilitada = true where id; perform tests.act_as_service();   -- R4-B2-3b: la IA solo sale con su canal encendido
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:2', 'Sí, enviamos a todo México.');
  perform tests.ok(exists (select 1 from public.cc_wa_salida where conversation_id = c and texto = 'Sí, enviamos a todo México.' and estado = 'pendiente' and wa_id = '5216671239999'), '1 · la respuesta de la IA se forma para WhatsApp');
  perform public._cc_sistema(c, 'Lucía se unió a la conversación.', 'sys:prueba');
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where conversation_id = c and texto like 'Lucía se unió%'), '1 · los avisos del sistema no salen');
  perform tests.ok((select count(*) from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c and m.actor_type <> 'system') = 1, '1 · lo que escribe el cliente no se le reenvía (solo la respuesta de la IA)');
  perform tests.ok((select count(*) = 1 and bool_and(m.client_message_id like 'sys:wa:%') from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c and m.actor_type = 'system'), '1 · R4-B2-2: de los avisos del sistema solo sale el de la transferencia (sys:wa:)');

  -- reclamar / resolver sin dobles
  select count(*) into n from public.cc_wa_salida_reclamar(10);
  perform tests.ok(n = 2 and (select count(*) from public.cc_wa_salida_reclamar(10)) = 0, '2 · un envío se reclama una sola vez (respuesta de la IA + aviso de transferencia, R4-B2-2)');
  perform public.cc_wa_salida_resolver((select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c and m.actor_type = 'system'), true, 'wamid.OUT0000', null);
  select * into x from public.cc_wa_salida where conversation_id = c and texto = 'Sí, enviamos a todo México.';
  perform public.cc_wa_salida_resolver(x.id, true, 'wamid.OUT0001', null);
  perform tests.ok((select estado = 'enviado' and wamid = 'wamid.OUT0001' from public.cc_wa_salida where id = x.id) and exists (select 1 from public.cc_wa_mensajes where wamid = 'wamid.OUT0001' and direccion = 'out'), '2 · enviado con su wamid');

  -- acuse "read" → palomitas azules
  perform public.cc_wa_estado('wamid.OUT0001', 'read');
  perform tests.ok((select last_read_seq >= (select seq from public.cc_messages where id = x.message_id) from public.cc_participants where conversation_id = c and rol = 'dueno'), '3 · lo leyó en WhatsApp: palomitas azules');

  -- fuera de 24 h
  perform tests.act_as_owner(); update public.cc_wa_contactos set ultimo_entrante_at = now() - interval '25 hours' where wa_id = '5216671239999'; perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:3', '¿Sigues interesado?');
  perform tests.ok(exists (select 1 from public.cc_wa_salida where conversation_id = c and texto = '¿Sigues interesado?' and estado = 'fuera_ventana'), '4 · después de 24 h no se manda (queda marcado)');
  perform tests.ok((public.cc_wa_conversacion(c) ->> 'ventana_abierta')::boolean = false and (public.cc_wa_conversacion(c) ->> 'fallidos')::int = 1, '4 · la pantalla sabe que la ventana está cerrada');

  -- fallo y reintentos
  perform tests.act_as_owner(); update public.cc_wa_contactos set ultimo_entrante_at = now() where wa_id = '5216671239999'; perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:4', 'Te paso el catálogo.');
  select * into x from public.cc_wa_salida_reclamar(10) limit 1;
  perform public.cc_wa_salida_resolver(x.id, false, null, 'Meta 429: límite');
  perform tests.ok((select estado = 'pendiente' and error = 'Meta 429: límite' from public.cc_wa_salida where id = x.id), '5 · si Meta lo rechaza por cupo, vuelve a la cola para reintentar (R4-B2-2: un 5xx quedaría incierto)');

  -- una conversación sin WhatsApp no forma nada
  d := tests.user('doctor', 'sinwa@t.local');
  c_web := (public.cc_abrir_conversacion(null, d) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(c_web, 'doctor', null, d, 'd:1', 'Hola');
  perform public.cc_enviar_mensaje(c_web, 'ai', null, null, 'ai:5', 'Hola, doctor');
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where conversation_id = c_web) and public.cc_wa_conversacion(c_web) is null, '6 · chat web: nada sale por WhatsApp');

  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from cron.job where jobname = 'renovacell-whatsapp' and command = 'select public._whatsapp_despachar()'), '7 · respaldo cada minuto');
  perform tests.act_as(s1);
  perform tests.throws('select * from public.cc_wa_salida_reclamar(1)', 'permission denied', '7 · nadie la llama directo');
end $t$;
rollback;
