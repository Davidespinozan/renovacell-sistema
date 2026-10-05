-- CC-0A · Autoridad sobre `profiles.meta`: un doctor edita sus datos legítimos pero NO la
-- evidencia ni la autoridad con la que se decide verified/aprobación/propiedad; Dirección,
-- el servidor (service_role) y los comandos sí. La verificación final sigue siendo humana.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos');
  v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); k text;
  v_meta jsonb := jsonb_build_object(
    'name', 'Dra. Prueba', 'cedula', '1234567',
    'verification', jsonb_build_object('status', 'pending', 'auto_ok', false),
    'verifyResult', jsonb_build_object('decision', 'review'),
    'identity', jsonb_build_object('status', 'pending'),
    'commercial', jsonb_build_object('status', 'NOT_FOUND'),
    'owner', 'vendedor@renovacell.mx', 'shipping', jsonb_build_object('city', 'Mazatlán'),
    'seller_profile_id', 'uuid-x', 'fromProspect', true, 'invited', true, 'capabilities', jsonb_build_array(),
    'active', true, 'baja', false);
begin
  perform tests.act_as_service();
  update public.profiles set verified = false, meta = v_meta where id = v_nov;
  perform tests.act_as_owner();

  -- ══ H · lo legítimo sigue editable por el propio doctor ══════════════════
  perform tests.act_as(v_nov);
  update public.profiles set meta = meta || '{"name": "Dra. Prueba Editada", "avatar_url": "x.png"}'::jsonb where id = v_nov;
  update public.profiles set meta = jsonb_set(meta, '{fiscal}', '{"rfc": "XAXX010101000"}'::jsonb) where id = v_nov;
  update public.profiles set meta = jsonb_set(meta, '{shipping,city}', '"Culiacán"'::jsonb), full_name = 'Prueba', organization = 'Clínica' where id = v_nov;
  perform tests.eq((select meta ->> 'name' from public.profiles where id = v_nov), 'Dra. Prueba Editada', 'H · doctor edita name');
  perform tests.eq((select meta -> 'shipping' ->> 'city' from public.profiles where id = v_nov), 'Culiacán', 'H · doctor edita shipping');
  perform tests.eq((select meta -> 'fiscal' ->> 'rfc' from public.profiles where id = v_nov), 'XAXX010101000', 'H · doctor edita fiscal (legacy)');

  -- ══ F/G · evidencia y autoridad: rechazado y preservado ══════════════════
  foreach k in array array['verification','identity','verifyResult','cedula','commercial','owner','seller_profile_id','fromProspect','invited','capabilities','active','baja'] loop
    perform tests.throws_any(format('update public.profiles set meta = jsonb_set(coalesce(meta,''{}''), %L, ''"forjado"''::jsonb) where id = %L', array[k], v_nov),
      array['META_PROTEGIDA','No autorizado'], 'F/G · doctor no puede escribir meta.' || k);
    perform tests.throws_any(format('update public.profiles set meta = meta - %L where id = %L', k, v_nov),
      array['META_PROTEGIDA','No autorizado'], 'F/G · doctor no puede borrar meta.' || k);
  end loop;
  perform tests.eq((select meta -> 'verification' ->> 'status' from public.profiles where id = v_nov), 'pending', 'F · verification preservada');
  perform tests.eq((select meta ->> 'cedula' from public.profiles where id = v_nov), '1234567', 'G · cedula preservada');
  -- Reescribir TODO el meta (como hace el cliente con merge) con la evidencia intacta: pasa.
  update public.profiles set meta = (select meta || '{"name": "Dra. Merge"}'::jsonb from public.profiles where id = v_nov) where id = v_nov;
  perform tests.eq((select meta ->> 'name' from public.profiles where id = v_nov), 'Dra. Merge', 'H · merge completo con evidencia intacta pasa');
  -- Y con la evidencia alterada dentro del merge: no pasa.
  perform tests.throws(format('update public.profiles set meta = (select meta || ''{"verification": {"status": "verified"}}''::jsonb from public.profiles where id = %L) where id = %L', v_nov, v_nov),
    'META_PROTEGIDA', 'F · autoverificarse vía merge: rechazado');
  perform tests.throws(format('update public.profiles set verified = true where id = %L', v_nov), 'No autorizado', 'F · verified sigue bloqueado (W6-A1)');
  perform tests.eq((select verified from public.profiles where id = v_nov), false, 'K · sigue sin verificar');

  -- Un vendedor no edita el perfil de un doctor (RLS self-or-admin): 0 filas, nada cambia.
  perform tests.act_as(v_pos);
  update public.profiles set meta = jsonb_set(meta, '{owner}', '"yo"'::jsonb) where id = v_nov;
  perform tests.act_as_owner();
  perform tests.eq((select meta ->> 'owner' from public.profiles where id = v_nov), 'vendedor@renovacell.mx', 'POS no toca el perfil ajeno');

  -- ══ L · Dirección, servidor y comando conservan su autoridad ═════════════
  perform tests.act_as(v_admin);
  update public.profiles set meta = jsonb_set(meta, '{verification}', '{"status": "rejected", "reason": "x"}'::jsonb), verified = false where id = v_nov;
  perform tests.eq((select meta -> 'verification' ->> 'status' from public.profiles where id = v_nov), 'rejected', 'L · Dirección rechaza (escribe verification)');
  update public.profiles set meta = jsonb_set(meta, '{owner}', '"otro@renovacell.mx"'::jsonb) where id = v_nov;
  perform tests.eq((select meta ->> 'owner' from public.profiles where id = v_nov), 'otro@renovacell.mx', 'L · Dirección reasigna owner');
  perform tests.act_as_service();
  update public.profiles set meta = jsonb_set(meta, '{verifyResult}', '{"decision": "auto"}'::jsonb) where id = v_nov;
  perform tests.eq((select meta -> 'verifyResult' ->> 'decision' from public.profiles where id = v_nov), 'auto', 'L · servidor (verify-cedula/register-doctor) escribe evidencia');
  perform tests.eq((select verified from public.profiles where id = v_nov), false, 'K · evidencia SEP "auto" NO verifica: sigue humano');
  perform tests.act_as(v_admin);
  perform public.admin_approve_doctor(v_nov, null, jsonb_build_object('full_name', 'Prueba'));
  perform tests.eq((select verified from public.profiles where id = v_nov), true, 'K · admin_approve_doctor (humano) sí verifica');
  perform tests.eq((select meta -> 'verification' ->> 'status' from public.profiles where id = v_nov), 'verified', 'K · y deja la evidencia de la aprobación');
  perform tests.act_as(v_doc);
  perform tests.throws(format('update public.profiles set meta = jsonb_set(coalesce(meta,''{}''), ''{capabilities}'', ''["diseno"]''::jsonb) where id = %L', v_doc),
    'No autorizado', 'capabilities sigue bloqueada (W6-A1)');
  perform tests.act_as_owner();
end $t$;
rollback;
