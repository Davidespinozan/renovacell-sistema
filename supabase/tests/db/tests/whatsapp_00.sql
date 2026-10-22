-- WHATSAPP EN EL CHAT (167) · los WhatsApp entran a la conversación de su dueño (doctor por celular o visitante interno),
-- sin duplicar ante reintentos de Meta; en modo espejo no se encolan; en activo van a su vendedora o a Dirección.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); dA uuid; dB uuid; dC uuid; r jsonb; r2 jsonb; c uuid; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  dA := tests.user('doctor', 'wa-doc@t.local');
  update public.profiles set meta = coalesce(meta, '{}') || '{"shipping":{"phone":"667 255 6669"}}' where id = dA;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1);
  dB := tests.user('doctor', 'wa-dup1@t.local'); dC := tests.user('doctor', 'wa-dup2@t.local');
  update public.profiles set meta = coalesce(meta, '{}') || '{"shipping":{"phone":"6670000777"}}' where id in (dB, dC);

  -- 1 · desconocido: visitante interno + conversación + mensaje
  r := public.cc_wa_entrante('5216671112233', 'Ana Ruiz', 'wamid.AAA111', 'Hola, ¿tienen la mascarilla?', false);
  c := (r ->> 'conversation_id')::uuid;
  perform tests.ok(r ->> 'actor' = 'visitor' and not (r ->> 'duplicado')::boolean
    and exists (select 1 from public.cc_messages where conversation_id = c and content = 'Hola, ¿tienen la mascarilla?' and actor_type = 'visitor' and client_message_id = public._cc_client_id_canal('wa', 'wamid.AAA111')), '1 · desconocido: entra como visitante con su mensaje');
  perform tests.eq(public._cc_nombre_dueno(c), 'Ana Ruiz (WhatsApp)', '1 · en Conversaciones se ve "Ana Ruiz (WhatsApp)"');
  perform tests.ok((select modo = 'ai_active' and seller_profile_id is null from public.cc_conversations where id = c), '1 · modo espejo: no entra a la cola ni se asigna');

  -- 2 · reintento de Meta del mismo mensaje
  r2 := public.cc_wa_entrante('5216671112233', 'Ana Ruiz', 'wamid.AAA111', 'Hola, ¿tienen la mascarilla?', false);
  perform tests.ok((r2 ->> 'duplicado')::boolean and (select count(*) from public.cc_messages where conversation_id = c) = 1, '2 · el mismo wamid no duplica');
  r2 := public.cc_wa_entrante('5216671112233', null, 'wamid.AAA222', '¿Y el precio?', false);
  perform tests.ok((r2 ->> 'conversation_id')::uuid = c and (select count(*) from public.cc_messages where conversation_id = c and actor_type = 'visitor') = 2, '2 · otro mensaje del mismo número, misma conversación');

  -- 3 · doctor por su celular (con lada de país)
  r := public.cc_wa_entrante('5216672556669', 'Dr. Ejemplo', 'wamid.BBB111', 'Quiero pedir 3 cajas', true);
  perform tests.ok(r ->> 'actor' = 'doctor' and (r ->> 'profile_id')::uuid = dA
    and (select profile_id = dA from public.cc_conversations where id = (r ->> 'conversation_id')::uuid), '3 · doctor reconocido por celular: es SU conversación');
  perform tests.ok((select modo in ('human_requested', 'human_assigned') and seller_profile_id = s1 from public.cc_conversations where id = (r ->> 'conversation_id')::uuid), '3 · modo activo: a la cola de su vendedora de cartera (' || (select modo || '/' || coalesce(seller_profile_id::text, '-') from public.cc_conversations where id = (r ->> 'conversation_id')::uuid) || ')');

  -- 4 · celular de dos cuentas: no se adivina
  r := public.cc_wa_entrante('5216670000777', 'Alguien', 'wamid.CCC111', 'Hola', false);
  perform tests.ok(r ->> 'actor' = 'visitor' and r ->> 'profile_id' is null, '4 · celular ambiguo: visitante, no se liga a ninguna cuenta');

  -- 5 · entradas inválidas y permisos
  perform tests.throws($$select public.cc_wa_entrante('abc', 'x', 'wamid.DDD111', 'hola', false)$$, 'WA_DATOS_INVALIDOS', '5 · número inválido');
  perform tests.throws($$select public.cc_wa_entrante('5216671112233', 'x', 'wamid.DDD222', '   ', false)$$, 'WA_SIN_TEXTO', '5 · sin texto');
  perform tests.act_as(s1);
  perform tests.throws($$select public.cc_wa_entrante('5216671112233', 'x', 'wamid.EEE111', 'hola', false)$$, 'permission denied', '5 · nadie la llama directo');
  perform tests.throws('select count(*) from public.cc_wa_contactos', 'permission denied', '5 · los contactos no se leen directo');
end $t$;
rollback;
