-- R4-B1 · el teléfono NO prueba identidad: ningún WhatsApp se liga solo a un doctor (verificado o no, por su perfil, por
-- cambio de teléfono o por customers.phone, ni con números repetidos). Todo contacto queda como visitante aislado; el doctor
-- no lee esas conversaciones (RLS directa); Dirección y la vendedora asignada sí. Recepción e idempotencia intactas.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos');
        dU uuid; dV uuid; dB uuid; dC uuid; dK uuid; r jsonb; cU uuid; cV uuid; cV2 uuid; cK uuid; n bigint;
begin
  perform tests.act_as_service();   -- fixtures con la llave de servicio (profiles_guard protege verified)
  dU := tests.user('doctor', 'r4b1-sinverif@t.local');
  update public.profiles set verified = false, meta = coalesce(meta, '{}') || '{"shipping":{"phone":"667 111 2001"},"verification":{"status":"pending"}}' where id = dU;
  dV := tests.user('doctor', 'r4b1-verif@t.local');
  update public.profiles set meta = coalesce(meta, '{}') || '{"shipping":{"phone":"6671112002"}}' where id = dV;
  dB := tests.user('doctor', 'r4b1-dup1@t.local'); dC := tests.user('doctor', 'r4b1-dup2@t.local');
  update public.profiles set meta = coalesce(meta, '{}') || '{"shipping":{"phone":"6671112004"}}' where id in (dB, dC);
  dK := tests.user('doctor', 'r4b1-cliente@t.local');
  insert into public.customers (full_name, phone, profile_id) values ('Cliente R4-B1', '6671112005', dK);
  perform tests.act_as_owner();
  perform tests.ok(public._cc_wa_perfil('5216671112001') is null and public._cc_wa_perfil('5216671112002') is null
    and public._cc_wa_perfil('5216671112004') is null and public._cc_wa_perfil('5216671112005') is null, '0 · _cc_wa_perfil nunca devuelve un perfil');

  perform tests.act_as_service();
  -- 1 · doctor SIN verificar con ese teléfono: no se liga
  r := public.cc_wa_entrante('5216671112001', 'Paciente A', 'wamid.R4B1.U1', 'mensaje privado A', false);
  cU := (r ->> 'conversation_id')::uuid;
  perform tests.ok(r ->> 'actor' = 'visitor' and r ->> 'profile_id' is null, '1 · doctor sin verificar: el WhatsApp entra como visitante');
  perform tests.ok((select profile_id is null and visitor_id is not null from public.cc_conversations where id = cU), '1 · conversación de visitante, sin dueño doctor');
  -- 2 · doctor VERIFICADO con ese teléfono: tampoco
  r := public.cc_wa_entrante('5216671112002', 'Paciente B', 'wamid.R4B1.V1', 'mensaje privado B', false);
  cV := (r ->> 'conversation_id')::uuid;
  perform tests.ok(r ->> 'actor' = 'visitor' and r ->> 'profile_id' is null, '2 · doctor verificado: tampoco se liga por teléfono');
  -- 3 · dos doctores con el mismo número
  r := public.cc_wa_entrante('5216671112004', 'Paciente C', 'wamid.R4B1.D1', 'hola', false);
  perform tests.ok(r ->> 'actor' = 'visitor' and r ->> 'profile_id' is null, '3 · número repetido en dos cuentas: no se liga');
  -- 4 · coincidencia solo por customers.phone
  r := public.cc_wa_entrante('5216671112005', 'Paciente D', 'wamid.R4B1.K1', 'hola', false);
  cK := (r ->> 'conversation_id')::uuid;
  perform tests.ok(r ->> 'actor' = 'visitor' and r ->> 'profile_id' is null, '4 · teléfono del cliente (customers): no se liga');
  -- 5 · mensajes siguientes y reintentos: misma conversación de visitante, sin duplicar
  r := public.cc_wa_entrante('5216671112001', null, 'wamid.R4B1.U2', 'segundo mensaje privado A', false);
  perform tests.ok((r ->> 'conversation_id')::uuid = cU and r ->> 'actor' = 'visitor', '5 · el siguiente mensaje sigue en la conversación de visitante');
  r := public.cc_wa_entrante('5216671112001', null, 'wamid.R4B1.U2', 'segundo mensaje privado A', false);
  perform tests.ok((r ->> 'duplicado')::boolean and (select count(*) from public.cc_messages where conversation_id = cU) = 2, '5 · el reintento de Meta no duplica');
  -- 7 · el doctor verificado cambia su teléfono al de otra persona: sigue sin ligarse (mensajes futuros)
  perform tests.act_as(dV);   -- el propio doctor edita su teléfono (meta.shipping es editable por él)
  update public.profiles set meta = meta || '{"shipping":{"phone":"6671112009"}}' where id = dV;
  perform tests.act_as_service();
  perform tests.ok((select meta -> 'shipping' ->> 'phone' = '6671112009' from public.profiles where id = dV), '7 · el doctor pudo cambiar su teléfono');
  r := public.cc_wa_entrante('5216671112009', 'Otra persona', 'wamid.R4B1.V9', 'mensaje de otra persona', false);
  cV2 := (r ->> 'conversation_id')::uuid;
  perform tests.ok(r ->> 'actor' = 'visitor' and r ->> 'profile_id' is null, '7 · cambiar el teléfono del perfil no captura el número');
  -- contactos: ninguno ligado, wa_id tal como llegó
  perform tests.ok(not exists (select 1 from public.cc_wa_contactos where profile_id is not null), 'contactos · ninguno ligado a un perfil');
  perform tests.ok((select count(*) = 5 from public.cc_wa_contactos where wa_id in ('5216671112001', '5216671112002', '5216671112004', '5216671112005', '5216671112009')), 'contactos · wa_id guardado tal como llega');

  -- 6 · RLS directa (como en Supabase): ningún doctor ve esas conversaciones ni sus mensajes
  update public.cc_conversations set seller_profile_id = s1 where id = cK;   -- asignada a s1 (para probar acceso de personal)
  perform tests.act_as(dU);
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = cU), 0::bigint, '6 · doctor sin verificar: 0 mensajes del número que registró');
  perform tests.eq((select count(*) from public.cc_conversations where id = cU), 0::bigint, '6 · doctor sin verificar: no ve la conversación');
  perform tests.eq((select count(*) from public.cc_messages m join public.cc_conversations c on c.id = m.conversation_id where c.visitor_id is not null), 0::bigint, '6 · doctor sin verificar: 0 mensajes de cualquier visitante');
  perform tests.act_as(dV);
  perform tests.eq((select count(*) from public.cc_messages where conversation_id in (cV, cV2)), 0::bigint, '6 · doctor verificado: 0 mensajes de su número viejo o del nuevo');
  perform tests.act_as(dK);
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = cK), 0::bigint, '6 · cliente con ese teléfono: 0 mensajes');
  -- personal autorizado conserva su acceso; otra vendedora no
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.cc_conversations where id in (cU, cV, cK, cV2)) = 4 and (select count(*) from public.cc_messages where conversation_id = cU) = 2, '6 · Dirección ve las conversaciones y sus mensajes');
  perform tests.act_as(s1);
  perform tests.ok((select count(*) from public.cc_messages where conversation_id = cK) = 1 and (select count(*) from public.cc_conversations where id = cU) = 0, '6 · la vendedora asignada ve SU conversación y no las demás');
  perform tests.act_as(s2);
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = cK), 0::bigint, '6 · otra vendedora no la ve');
  -- escritura: ningún cliente escribe directo
  perform tests.act_as(dU);
  perform tests.throws($$insert into public.cc_messages (conversation_id, seq, actor_type, actor_profile_id, content, content_hash) select id, 99, 'doctor', auth.uid(), 'x', md5('x') from public.cc_conversations limit 1$$, 'permission denied', '6 · el doctor no inserta mensajes directo');
  perform tests.throws($$update public.cc_conversations set profile_id = auth.uid()$$, 'permission denied', '6 · el doctor no se apropia de conversaciones');
  perform tests.throws($$select public._cc_wa_perfil('5216671112001')$$, 'permission denied', '6 · _cc_wa_perfil no es ejecutable por clientes');
end $t$;
rollback;
