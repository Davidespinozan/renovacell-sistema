-- BOT DETECTADO (6 nov 2026) · el freno ANTIBOT deja evento + aviso (Dirección y, si hay, el vendedor) una vez cada 24 h, y el
-- chat del personal lo ve en cc_canal_conversacion. Solo el servicio lo marca; al contacto no le llega nada.
begin;
-- cc_canal_conversacion es solo del servicio: la prueba la lee como servicio y regresa al rol del dueño.
create or replace function public.tests_canal(p uuid) returns jsonb language plpgsql as $f$ declare r jsonb; begin perform tests.act_as_service(); r := public.cc_canal_conversacion(p); perform tests.act_as_owner(); return r; end $f$;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos');
  c1 uuid; c2 uuid; r jsonb; n_msgs int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  c1 := (public.cc_wa_entrante('5218007112222', null, 'wamid.BOT0000001', 'Envió un mensaje por WhatsApp.', false) ->> 'conversation_id')::uuid;
  c2 := (public.cc_wa_entrante('5216671112233', 'Ana Ruiz', 'wamid.BOT0000002', 'Hola', false) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  select count(*)::int into n_msgs from public.cc_messages where conversation_id = c1;
  perform tests.ok(tests_canal(c1) -> 'bot' = 'null'::jsonb or tests_canal(c1) ->> 'bot' is null, '0 · sin aviso todavía');

  -- 1 · solo el servicio
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_bot_detectado(%L, ''automatico'')', c1), 'permission denied', '1 · Dirección no lo marca a mano');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_bot_detectado(%L, ''automatico'')', c1), 'permission denied', '1 · un vendedor tampoco');

  -- 2 · el freno lo marca: evento, aviso a Dirección con el número, nada al contacto
  perform tests.act_as_service();
  r := public.cc_bot_detectado(c1, 'numero_empresa');
  perform tests.ok((r ->> 'nuevo')::boolean, '2 · primera vez: nuevo');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = c1 and tipo = 'bot_detectado' and detalle ->> 'motivo' = 'numero_empresa'), 1, '2 · evento con el motivo');
  perform tests.ok(exists (select 1 from public.notifications where conversation_id = c1 and kind = 'bot_detectado' and roles = array['admin'] and user_ids is null
                   and body like 'Posible bot: +5218007112222 (WhatsApp)%'), '2 · aviso a Dirección con el número (no trae nombre)');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c1), n_msgs, '2 · al contacto no le llega ningún mensaje');
  perform tests.ok(tests_canal(c1) -> 'bot' ->> 'motivo' = 'numero_empresa', '2 · el chat del personal recibe `bot`');
  perform tests.ok(tests_canal(c1) ->> 'canal' = 'whatsapp' and tests_canal(c1) ? 'ventana_abierta', '2 · lo demás del canal sigue igual');

  -- 3 · un bucle no llena la campana: una vez cada 24 h
  perform tests.act_as_service();
  r := public.cc_bot_detectado(c1, 'eco');
  perform tests.ok(not (r ->> 'nuevo')::boolean, '3 · segunda vez en 24 h: no repite');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'bot_detectado'), 1, '3 · un solo aviso');
  -- la bitácora es solo-agregar: para simular «hace 25 h» se apagan los disparadores SOLO en esta prueba
  perform set_config('session_replication_role', 'replica', true);
  update public.cc_conversation_events set created_at = now() - interval '25 hours' where conversation_id = c1 and tipo = 'bot_detectado';
  perform set_config('session_replication_role', 'origin', true);
  perform tests.ok(tests_canal(c1) ->> 'bot' is null, '3 · pasado el día, el aviso del chat se quita');
  perform tests.act_as_service();
  perform tests.ok((public.cc_bot_detectado(c1, 'eco') ->> 'nuevo')::boolean, '3 · y si vuelve, se avisa otra vez');

  -- 4 · con vendedor asignado, también a él; con nombre, se usa el nombre
  perform tests.act_as_owner();
  update public.cc_conversations set seller_profile_id = s1 where id = c2;
  perform tests.act_as_service();
  perform public.cc_bot_detectado(c2, 'automatico');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.notifications where conversation_id = c2 and kind = 'bot_detectado' and user_ids = array[s1] and roles = array['admin']
                   and body like 'Posible bot: Ana Ruiz (WhatsApp)%'), '4 · aviso al vendedor y a Dirección, con su nombre');
  perform tests.ok(tests_canal(c2) ->> 'bot' is not null and tests_canal(c1) -> 'bot' ->> 'motivo' = 'eco', '4 · cada conversación con su propio aviso');
end $t$;
rollback;
