-- META-04 (188) · wamids largos: cortos y largos entran, el client_message_id es un derivado de longitud fija, el wamid completo
-- manda en la deduplicación (duplicados y reintentos), contactos existentes y doctores siguen en su conversación, Meta igual,
-- y los mensajes históricos (client_message_id 'wa:' || wamid) no se tocan.
begin;
do $t$
declare r jsonb; r2 jsonb; v_conv uuid; v_msg uuid; n_antes bigint; v_doc uuid; v_tel text := '5216671230044'; v_cid text; v_hash text;
        w_corto text := 'wamid.' || repeat('A', 56);                     -- 62 (los que ya entraban)
        w_largo text := 'wamid.HBgNNTIxNjY3MTIzMDAxMRUCABIYIDQ3REY0NEQ4MzE5RjA3OTQ5OTdGQkFBMEU3NDI0N0YwAA==';   -- 82 (formato nuevo)
        w_tope  text := 'wamid.' || repeat('Z', 194);                    -- 200 (límite de cc_wa_mensajes)
        m_largo text := 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDE1NTIxODc4MTQ3OjM0MDI4MjM2Njg0MTcxMDMwMDk0OTEyODE3NTMyMDAzMTA0MTk3NTo0OTM1Mzg1MDU2MzkwNjQ3MDc4MzQ2MTI4MzE5OTg0ODQ0OAZDZD';   -- 164 (forma de un mid real de Instagram)
begin
  perform tests.act_as_service();
  perform tests.eq(length(w_largo), 82, 'fixture · wamid largo de 82'); perform tests.ok(length(m_largo) > 80, 'fixture · mid de Instagram mayor que 80 (' || length(m_largo) || ')');
  -- histórico: un mensaje guardado ANTES de la 188 conserva su client_message_id 'wa:' || wamid (cc_messages es append-only:
  -- no se puede editar; se reproduce la forma de la 168 escribiendo el mensaje y el registro del wamid como lo hacía esa versión)
  r := public.cc_wa_entrante('5216671230001', 'Histórico', 'wamid.' || repeat('H', 56), 'primero', false);
  v_conv := (r ->> 'conversation_id')::uuid;
  perform tests.act_as_owner(); select visitor_hash into v_hash from public.cc_wa_contactos where wa_id = '5216671230001'; perform tests.act_as_service();
  r := public.cc_enviar_mensaje(v_conv, 'visitor', v_hash, null, 'wa:' || w_corto, 'mensaje de antes');   -- forma histórica (como los 23 de prod)
  v_msg := (r ->> 'id')::uuid;
  perform tests.act_as_owner();
  insert into public.cc_wa_mensajes (wamid, wa_id, conversation_id, message_id, direccion) values (w_corto, '5216671230001', v_conv, v_msg, 'in');
  perform tests.act_as_service();
  perform tests.ok((public.cc_wa_entrante('5216671230001', 'Histórico', w_corto, 'mensaje de antes', false) ->> 'duplicado')::boolean, '0 · un reintento del wamid histórico sigue siendo duplicado');

  -- 1 · corto: entra, derivado de 67
  r := public.cc_wa_entrante('5216671230002', 'Corto', 'wamid.' || repeat('B', 56), 'hola', false);
  perform tests.ok((r ->> 'duplicado')::boolean = false, '1 · corto entra');
  select client_message_id into v_cid from public.cc_messages where id = (r ->> 'message_id')::uuid;
  perform tests.ok(v_cid like 'wa:%' and length(v_cid) = 67, '1 · client_message_id derivado wa:sha256 (67)');
  -- 2 · largo (82): ANTES 23514, AHORA entra; el wamid completo queda en cc_wa_mensajes
  r := public.cc_wa_entrante('5216671230003', 'Largo', w_largo, 'mensaje con wamid largo', false);
  perform tests.ok((r ->> 'duplicado')::boolean = false and (r ->> 'actor') = 'visitor', '2 · wamid de 82 entra');
  perform tests.ok(exists (select 1 from public.cc_wa_mensajes where wamid = w_largo and direccion = 'in'), '2 · wamid completo guardado como autoridad');
  perform tests.ok((select length(client_message_id) = 67 from public.cc_messages where id = (r ->> 'message_id')::uuid), '2 · derivado de longitud fija');
  -- 3 · tope de 200: entra; 201 sigue rechazado por la validación propia
  r := public.cc_wa_entrante('5216671230003', 'Largo', w_tope, 'otro', false);
  perform tests.ok((r ->> 'duplicado')::boolean = false, '3 · wamid de 200 entra');
  perform tests.throws(format($q$select public.cc_wa_entrante('5216671230003', 'Largo', '%s', 'x', false)$q$, w_tope || 'X'), 'WA_DATOS_INVALIDOS', '3 · 201 sigue siendo inválido');
  -- 4 · duplicado / reintento de Meta del MISMO wamid largo: no duplica ni cambia nada
  select count(*) into n_antes from public.cc_messages;
  r2 := public.cc_wa_entrante('5216671230003', 'Largo', w_largo, 'mensaje con wamid largo', false);
  perform tests.ok((r2 ->> 'duplicado')::boolean and (r2 ->> 'conversation_id') = (r ->> 'conversation_id'), '4 · reintento = duplicado, misma conversación');
  perform tests.eq((select count(*) from public.cc_messages), n_antes, '4 · sin mensaje nuevo');
  perform tests.eq((select count(*) from public.cc_wa_mensajes where wamid = w_largo), 1::bigint, '4 · un solo registro del wamid');
  -- 5 · reintento tras fallo parcial (cc_enviar_mensaje escribió, cc_wa_mensajes no): mismo derivado → idempotente, no duplica
  delete from public.cc_wa_mensajes where wamid = w_tope;
  r2 := public.cc_wa_entrante('5216671230003', 'Largo', w_tope, 'otro', false);
  perform tests.ok((r2 ->> 'duplicado')::boolean = false and (r2 ->> 'message_id') = (select id::text from public.cc_messages where client_message_id = public._cc_client_id_canal('wa', w_tope)), '5 · reintento tras fallo parcial reutiliza el mensaje (idempotente)');
  perform tests.eq((select count(*) from public.cc_messages where client_message_id = public._cc_client_id_canal('wa', w_tope)), 1::bigint, '5 · un solo mensaje');
  -- 6 · contacto existente (histórico) recibe ahora un wamid largo: misma conversación, mismo visitante
  r := public.cc_wa_entrante('5216671230001', 'Histórico', 'wamid.' || repeat('C', 76), 'volví', false);
  perform tests.ok((r ->> 'conversation_id')::uuid = v_conv and (r ->> 'actor') = 'visitor', '6 · contacto existente sigue en su conversación');
  perform tests.eq((select client_message_id from public.cc_messages where id = v_msg), 'wa:' || w_corto, '6 · el mensaje histórico no se modifica');
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = v_conv and actor_type = 'visitor'), 3::bigint, '6 · tres mensajes del visitante (primero, histórico y el nuevo)');
  -- 7 · número de un doctor con wamid largo (R4-B1: no se liga por teléfono)
  perform tests.act_as_owner();
  v_doc := tests.user('doctor'); update public.profiles set meta = coalesce(meta, '{}') || jsonb_build_object('shipping', jsonb_build_object('phone', right(v_tel, 10))) where id = v_doc;
  perform tests.act_as_service();
  r := public.cc_wa_entrante(v_tel, 'Dra', 'wamid.' || repeat('D', 90), 'soy doctora', false);
  perform tests.ok((r ->> 'actor') = 'visitor' and r ->> 'profile_id' is null, '7 · R4-B1: celular de un doctor con wamid largo → visitante (no se liga)');
  perform tests.ok((select length(client_message_id) = 67 and actor_type = 'visitor' from public.cc_messages where id = (r ->> 'message_id')::uuid), '7 · derivado de 67 también en ese caso');
  -- 8 · Meta: mid real de Instagram (155) entra; duplicado por mid
  r := public.cc_meta_entrante('instagram', '17841400000000777', null, m_largo, 'hola por instagram', false);
  perform tests.ok((r ->> 'duplicado')::boolean = false, '8 · mid de Instagram de 164 entra');
  perform tests.ok((select length(client_message_id) = 69 and client_message_id like 'meta:%' from public.cc_messages where id = (r ->> 'message_id')::uuid), '8 · derivado meta: de 69');
  perform tests.ok((public.cc_meta_entrante('instagram', '17841400000000777', null, m_largo, 'hola por instagram', false) ->> 'duplicado')::boolean, '8 · reintento = duplicado');
  -- 9 · el derivado es determinista y distingue
  perform tests.ok(public._cc_client_id_canal('wa', w_largo) = public._cc_client_id_canal('wa', w_largo) and public._cc_client_id_canal('wa', w_largo) <> public._cc_client_id_canal('wa', w_largo || '1'), '9 · determinista y sin colisión trivial');
  perform tests.act_as(v_doc);
  perform tests.throws($q$select public._cc_client_id_canal('wa', 'x')$q$, 'denied', '9 · helper interno (sin execute para authenticated)');
  perform tests.act_as_owner();
end $t$;
rollback;
