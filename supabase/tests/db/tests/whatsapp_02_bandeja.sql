-- WHATSAPP · BANDEJA (169) · Dirección ve los chats de WhatsApp (en espejo y en activo) con su último mensaje; nadie más.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); d uuid; r jsonb; b jsonb; c uuid;
begin
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216671230001', 'Ana Prueba', 'wamid.B0001', 'Hola, ¿tienen bioestimuladores?', false);
  c := (r ->> 'conversation_id')::uuid;
  perform public.cc_wa_entrante('5216671230001', 'Ana Prueba', 'wamid.B0002', 'Sigo aquí', false);

  perform tests.act_as(v_admin);
  b := public.cc_wa_bandeja();
  perform tests.ok(b ->> 'modo' = 'espejo' and jsonb_array_length(b -> 'chats') = 1, '0 · Dirección ve el chat de WhatsApp aunque en espejo no se encole');
  perform tests.ok((b -> 'chats' -> 0 ->> 'wa_id') = '5216671230001' and (b -> 'chats' -> 0 ->> 'nombre') = 'Ana Prueba' and (b -> 'chats' -> 0 ->> 'conversation_id') = c::text
               and (b -> 'chats' -> 0 ->> 'n_mensajes')::int = 2 and (b -> 'chats' -> 0 ->> 'ultimo_texto') = 'Sigo aquí' and (b -> 'chats' -> 0 ->> 'ultimo_actor') = 'visitor'
               and (b -> 'chats' -> 0 ->> 'sin_responder')::boolean and (b -> 'chats' -> 0 ->> 'hace_min')::int = 0 and (b -> 'chats' -> 0 ->> 'ventana_abierta')::boolean and not (b -> 'chats' -> 0 ->> 'cliente')::boolean, '1 · número, nombre, conversación, conteo y último mensaje');

  -- la IA contesta: ya no está "sin responder"; un aviso del sistema no cuenta como último mensaje
  perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'ai', null, null, 'ai:b1', 'Sí, tenemos.');
  perform public._cc_sistema(c, 'Aviso del sistema', 'sys:b');
  perform tests.act_as(v_admin);
  b := public.cc_wa_bandeja();
  perform tests.ok((b -> 'chats' -> 0 ->> 'ultimo_texto') = 'Sí, tenemos.' and not (b -> 'chats' -> 0 ->> 'sin_responder')::boolean, '2 · el último mensaje es el de la IA, no el aviso del sistema');

  -- un doctor con cuenta que escribe por WhatsApp se ve como cliente
  d := tests.user('doctor', 'wa-doc@t.local');
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"name":"Dra. Wa","phone":"6671230002"}' where id = d;
  perform public.cc_wa_entrante('5216671230002', 'Dra', 'wamid.B0003', 'Buenas', false);
  perform tests.act_as(v_admin);
  b := public.cc_wa_bandeja();
  -- (en una misma transacción todos los mensajes comparten now(): el orden entre los dos chats no se afirma aquí)
  perform tests.ok(jsonb_array_length(b -> 'chats') = 2 and exists (select 1 from jsonb_array_elements(b -> 'chats') x where x ->> 'wa_id' = '5216671230002' and (x ->> 'cliente')::boolean and x ->> 'cliente_nombre' = 'Dra. Wa' and x ->> 'ultimo_texto' = 'Buenas'),
    '3 · el doctor con cuenta aparece como cliente, con su nombre y su mensaje');

  -- en activo también se ve
  perform tests.act_as_owner(); update public.cc_wa_config set modo = 'activo'; perform tests.act_as(v_admin);
  perform tests.ok((public.cc_wa_bandeja() ->> 'modo') = 'activo', '4 · reporta el modo del canal');

  -- nadie más
  perform tests.act_as(s1);
  perform tests.throws('select public.cc_wa_bandeja()', 'NO_AUTORIZADO', '5 · Ventas no ve la bandeja');
  perform tests.act_as(d);
  perform tests.throws('select public.cc_wa_bandeja()', 'NO_AUTORIZADO', '5 · un doctor tampoco');
  perform tests.act_as_anon();
  perform tests.throws('select public.cc_wa_bandeja()', 'permission denied', '5 · anónimo: sin permiso');
  perform tests.act_as_owner();
end $t$;
rollback;
