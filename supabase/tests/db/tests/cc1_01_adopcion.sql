-- CC-1 · Adopción: posesión del token + cuenta autenticada y activa; un visitante → un
-- perfil; un perfil → muchos visitantes; idempotente; el correo/teléfono no adoptan nada;
-- el token se rota al adoptar; verified no cambia; prospectos ligados sin fusionar identidades.
begin;
do $t$
declare
  v_a uuid := tests.user('doctor'); v_b uuid := tests.user('doctor'); v_sus uuid := tests.user('pos');
  hA text := repeat('a', 64); hB text := repeat('b', 64); hC text := repeat('c', 64); hD text := repeat('d', 64); hE text := repeat('e', 64);
  r jsonb; vidA uuid; vidB uuid; vidC uuid; vidD uuid; pA uuid; pB uuid; hash_despues text;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id in (v_a, v_b);          -- doctores recién registrados (no verificados)
  vidA := (public.cc_visitante_abrir(null, hA, '{"utm_source":"google"}'::jsonb, null) ->> 'visitor_id')::uuid;
  vidB := (public.cc_visitante_abrir(null, hB, '{"utm_source":"meta"}'::jsonb, null) ->> 'visitor_id')::uuid;
  vidC := (public.cc_visitante_abrir(null, hC, '{}'::jsonb, null) ->> 'visitor_id')::uuid;
  vidD := (public.cc_visitante_abrir(null, hD, '{}'::jsonb, null) ->> 'visitor_id')::uuid;

  -- ══ prospecto ligado por posesión del token (capture-lead) ══════════════
  insert into public.prospects (name, email, phone, source, status) values ('Ana', 'ana@x.mx', '6691234567', 'Landing', 'nuevo') returning id into pA;
  insert into public.prospects (name, email, phone, source, status) values ('Beto', 'beto@x.mx', '6697654321', 'Landing', 'nuevo') returning id into pB;
  perform tests.ok(public.cc_visitante_prospecto(hA, pA), 'prospecto A ligado al visitante A');
  perform tests.ok(not public.cc_visitante_prospecto(hB, pA), 'un prospecto ya ligado NO se re-liga (dedupe ≠ adopción)');
  perform tests.ok(not public.cc_visitante_prospecto(repeat('9', 64), pB), 'token inventado no liga nada');
  perform tests.ok(public.cc_visitante_prospecto(hB, pB), 'prospecto B ligado al visitante B');

  -- ══ A · visitante no adoptado + cuenta válida → ADOPT ═══════════════════
  r := public.cc_visitante_adoptar(hA, v_a);
  perform tests.eq(r ->> 'estado', 'adoptado', 'A · adoptado');
  perform tests.eq((r ->> 'visitor_id')::uuid, vidA, 'A · el visitante A');
  perform tests.act_as_owner();
  perform tests.eq((select adopted_profile_id from public.cc_visitors where id = vidA), v_a, 'adopted_profile_id = cuenta A');
  perform tests.eq((select estado from public.cc_visitors where id = vidA), 'adoptado', 'estado adoptado');
  select token_hash into hash_despues from public.cc_visitors where id = vidA;
  perform tests.ok(hash_despues <> hA and hash_despues ~ '^[0-9a-f]{64}$', 'el token se ROTÓ al adoptar (el viejo ya no sirve)');
  perform tests.eq((select verified from public.profiles where id = v_a), false, 'N · adoptar no verifica');
  perform tests.eq((select visitor_id from public.prospects where id = pA), vidA, 'el prospecto sigue ligado al visitante (y por él, a la cuenta)');

  -- ══ B · mismo perfil otra vez → idempotente; token viejo → sesión inválida ═
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_visitante_adoptar(%L, %L)', hA, v_a), 'SESION_INVALIDA', 'D · el token viejo ya no sirve (rotado) → sesión inválida genérica');
  r := public.cc_visitante_adoptar(hash_despues, v_a);
  perform tests.eq(r ->> 'estado', 'ya_adoptado', 'B · idempotente para la misma cuenta');
  perform tests.eq((select count(*)::int from public.cc_visitor_events where visitor_id = vidA and tipo = 'adoptado'), 1, 'B · un solo evento adoptado');

  -- ══ C · adoptado por otra cuenta → CONFLICTO ════════════════════════════
  r := public.cc_visitante_adoptar(hash_despues, v_b);
  perform tests.eq(r ->> 'estado', 'ajeno', 'C/G · la cuenta B no adopta el visitante de A (estado ajeno)');
  perform tests.act_as_owner();
  perform tests.eq((select adopted_profile_id from public.cc_visitors where id = vidA), v_a, 'C · sigue siendo de A');
  perform tests.ok(exists (select 1 from public.cc_visitor_events where visitor_id = vidA and tipo = 'conflicto' and actor_profile_id = v_b), 'C · el intento queda en bitácora');

  -- ══ D/E · correo o teléfono iguales NO adoptan nada ═════════════════════
  perform tests.act_as_service();
  update public.profiles set email = 'beto@x.mx' where id = v_b;             -- la cuenta B tiene el correo del prospecto B
  perform tests.throws(format('select public.cc_visitante_adoptar(%L, %L)', repeat('8', 64), v_b), 'SESION_INVALIDA', 'D · token inventado: ni el correo igual ayuda');
  r := public.cc_visitante_adoptar(null, v_b);
  perform tests.eq(r ->> 'estado', 'nada', 'E · sin token y sin vínculo de registro: no adopta nada aunque el correo coincida con un prospecto');
  perform tests.act_as_owner();
  perform tests.ok((select adopted_profile_id is null from public.cc_visitors where id = vidB), 'E · el visitante B sigue sin dueño');

  -- ══ vínculo del registro → adopción sin token (posesión probada al registrarse) ═
  perform tests.act_as_service();
  perform tests.ok(public.cc_visitante_vincular_registro(hB, v_b), 'registro vincula el visitante B a la cuenta B');
  perform tests.ok(not public.cc_visitante_vincular_registro(hB, v_a), 'V11 · un segundo registro desde el mismo visitante NO pisa el vínculo');
  r := public.cc_visitante_adoptar(hB, v_a);
  perform tests.eq(r ->> 'estado', 'ajeno', 'la cuenta A no adopta un visitante registrado por B aunque tenga el token');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.cc_visitor_events where visitor_id = vidB and tipo = 'conflicto' and actor_profile_id = v_a), 'el intento de A queda en bitácora');
  perform tests.act_as_service();
  r := public.cc_visitante_adoptar(null, v_b);
  perform tests.eq(r ->> 'estado', 'adoptado', 'B adopta sin token lo que su registro dejó vinculado');
  perform tests.eq((r ->> 'adoptados')::int, 1, 'exactamente 1');
  perform tests.act_as_owner();
  perform tests.eq((select adopted_profile_id from public.cc_visitors where id = vidB), v_b, 'visitante B → cuenta B');
  perform tests.act_as_service();
  r := public.cc_visitante_adoptar(null, v_b);
  perform tests.eq(r ->> 'estado', 'nada', 'idempotente: segunda vez no hay nada pendiente');

  -- ══ H · multi-dispositivo: la misma cuenta adopta un segundo visitante ══
  r := public.cc_visitante_adoptar(hC, v_a);
  perform tests.eq(r ->> 'estado', 'adoptado', 'H · la cuenta A adopta también el visitante C (otro dispositivo)');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_visitors where adopted_profile_id = v_a), 2, 'H · dos visitantes → un perfil');
  perform tests.eq((select count(distinct adopted_profile_id)::int from public.cc_visitors where id in (vidA, vidC)), 1, 'cada visitante tiene UN solo dueño');

  -- ══ M · cuenta suspendida no adopta; perfil inexistente no adopta ═══════
  perform tests.suspender(v_sus, 'prueba cc1');
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_visitante_adoptar(%L, %L)', hD, v_sus), 'CUENTA_SUSPENDIDA', 'M · cuenta suspendida: sin nueva autoridad por adopción');
  perform tests.throws(format('select public.cc_visitante_adoptar(%L, %L)', hD, gen_random_uuid()), 'PERFIL_INEXISTENTE', 'perfil inexistente no adopta');
  perform tests.throws(format('select public.cc_visitante_adoptar(%L, null)', hD), 'CC1_ARGUMENTOS', 'perfil requerido');
  perform tests.act_as_owner();
  perform tests.ok((select adopted_profile_id is null and estado = 'activo' from public.cc_visitors where id = vidD), 'el visitante D sigue libre');

  -- ══ un token adoptado que vuelve a la landing abre un visitante NUEVO ═══
  perform tests.act_as_service();
  r := public.cc_visitante_abrir(hA, hE, '{}'::jsonb, null);
  perform tests.eq((r ->> 'nuevo')::boolean, true, 'token viejo/adoptado en abrir → visitante nuevo, sin revelar nada');

  -- ══ O · la evidencia SEP no cambia verified (sigue siendo humano) ═══════
  update public.profiles set meta = jsonb_set(coalesce(meta,'{}'), '{verifyResult}', '{"decision":"auto"}') where id = v_a;
  perform tests.eq((select verified from public.profiles where id = v_a), false, 'O · evidencia auto no verifica');
  perform tests.act_as_owner();
end $t$;
rollback;
