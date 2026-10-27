-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-C6 · APERTURA DE LA COMPUERTA DE ACTIVACIÓN SOLO PARA WHATSAPP (autorizada por el dueño: WhatsApp IA-first en LIVE).
-- La compuerta _cc_canal_activacion_lista() era compartida: cc_canal_cambiar la usaba para los tres canales. Cambio mínimo:
--   · _cc_canal_activacion_lista() → true (la guardia de cc_wa_config, tabla solo de WhatsApp, deja pasar 'activo').
--   · cc_canal_cambiar: activar o encender la IA exige p_canal = 'whatsapp' Y la compuerta → Instagram y Messenger siguen
--     con ACTIVACION_BLOQUEADA. Única línea cambiada respecto a prod (definición tomada con pg_get_functiondef).
-- NO activa nada: el estado de los canales no cambia al instalar (se comprueba). Triggers, RLS, cola segura, último chequeo
-- antes del POST, exclusividad IA/humano y modo prueba quedan intactos.
-- Reversión exacta: supabase/rollback/whatsapp_compuerta_abierta/99_down.sql (se niega si WhatsApp no está en espejo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
begin
  if md5(pg_get_functiondef('public._cc_canal_activacion_lista()'::regprocedure)) <> '54c40af40a726e59236b607eed38c0cd' then raise exception 'R4-C6: _cc_canal_activacion_lista no es la esperada (0118)'; end if;
  if md5(pg_get_functiondef('public.cc_canal_cambiar(text,jsonb,text)'::regprocedure)) <> '882e73ca03bcd726fd03343bb74e29e9' then raise exception 'R4-C6: cc_canal_cambiar no es la esperada (0123)'; end if;
end $pre$;
select set_config('r4c6.estado_antes', (select string_agg(x, ',' order by x) from (select 'whatsapp:' || modo || ':' || ia_habilitada || ':' || envio_pausado x from public.cc_wa_config where id union all select canal || ':' || modo || ':' || ia_habilitada || ':' || envio_pausado from public.cc_meta_config) e), false);   -- estado de los canales antes de instalar

CREATE OR REPLACE FUNCTION public._cc_canal_activacion_lista()
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select true $function$;
comment on function public._cc_canal_activacion_lista() is 'R4-C6 · ABIERTA solo para WhatsApp: cc_canal_cambiar exige p_canal = ''whatsapp'' para activar o encender la IA (Instagram y Messenger siguen bloqueados); la guardia de cc_wa_config permite ''activo''. Reversión: supabase/rollback/whatsapp_compuerta_abierta/99_down.sql.';

CREATE OR REPLACE FUNCTION public.cc_canal_cambiar(p_canal text, p_cambios jsonb, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_mot text := btrim(coalesce(p_motivo, '')); k text;
        a_modo text; a_ia boolean; a_pausa boolean; n_modo text; n_ia boolean; n_pausa boolean;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if p_canal is null or p_canal not in ('whatsapp', 'instagram', 'messenger') then raise exception 'CANAL_INVALIDO: %', coalesce(p_canal, 'null') using errcode = 'check_violation'; end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' or p_cambios = '{}'::jsonb then raise exception 'CAMBIO_INVALIDO: se espera un objeto con modo, ia_habilitada o envio_pausado' using errcode = 'check_violation'; end if;
  for k in select jsonb_object_keys(p_cambios) loop
    if k not in ('modo', 'ia_habilitada', 'envio_pausado') then raise exception 'CAMBIO_INVALIDO: propiedad no permitida %', k using errcode = 'check_violation'; end if;
  end loop;
  if p_cambios ? 'modo' and (jsonb_typeof(p_cambios -> 'modo') <> 'string' or p_cambios ->> 'modo' not in ('espejo', 'activo', 'prueba')) then raise exception 'CAMBIO_INVALIDO: modo' using errcode = 'check_violation'; end if;
  if p_cambios ->> 'modo' = 'prueba' and p_canal <> 'whatsapp' then raise exception 'PRUEBA_SOLO_WHATSAPP: el modo prueba solo existe para WhatsApp' using errcode = 'check_violation'; end if;
  if p_cambios ? 'ia_habilitada' and jsonb_typeof(p_cambios -> 'ia_habilitada') <> 'boolean' then raise exception 'CAMBIO_INVALIDO: ia_habilitada' using errcode = 'check_violation'; end if;
  if p_cambios ? 'envio_pausado' and jsonb_typeof(p_cambios -> 'envio_pausado') <> 'boolean' then raise exception 'CAMBIO_INVALIDO: envio_pausado' using errcode = 'check_violation'; end if;

  -- Fila bloqueada: los cambios concurrentes del mismo canal se serializan y cada uno decide sobre el estado vigente.
  if p_canal = 'whatsapp' then select modo, ia_habilitada, envio_pausado into a_modo, a_ia, a_pausa from public.cc_wa_config where id for update;
  else select modo, ia_habilitada, envio_pausado into a_modo, a_ia, a_pausa from public.cc_meta_config where canal = p_canal for update; end if;
  if a_modo is null then raise exception 'CANAL_INVALIDO: sin configuración para %', p_canal using errcode = 'check_violation'; end if;

  n_modo := coalesce(p_cambios ->> 'modo', a_modo);
  n_ia := coalesce((p_cambios ->> 'ia_habilitada')::boolean, a_ia);
  n_pausa := coalesce((p_cambios ->> 'envio_pausado')::boolean, a_pausa);
  if n_modo = 'espejo' and n_ia and p_cambios ? 'ia_habilitada' then raise exception 'IA_REQUIERE_ACTIVO: la IA solo se enciende con el canal en activo' using errcode = 'check_violation'; end if;
  if n_modo = 'espejo' then n_ia := false; end if;   -- volver a espejo apaga la IA en el mismo cambio

  if (n_modo, n_ia, n_pausa) is not distinct from (a_modo, a_ia, a_pausa) then
    return jsonb_build_object('cambiado', false, 'canal', p_canal, 'estado', jsonb_build_object('modo', a_modo, 'ia_habilitada', a_ia, 'envio_pausado', a_pausa));
  end if;
  if length(v_mot) < 5 then raise exception 'MOTIVO_REQUERIDO: explica el cambio (mínimo 5 caracteres)' using errcode = 'check_violation'; end if;
  if length(v_mot) > 500 then raise exception 'MOTIVO_LARGO: máximo 500 caracteres' using errcode = 'check_violation'; end if;
  -- R4-C5 · 'activo' (y la IA en 'activo') siguen tras la compuerta; 'prueba' exige permisos vigentes y admite la IA
  if n_modo = 'prueba' and a_modo is distinct from 'prueba' and public._cc_canal_prueba_vigentes() = 0 then
    raise exception 'PRUEBA_SIN_PERMISOS: autoriza primero un contacto de prueba' using errcode = 'check_violation';
  end if;
  if ((n_modo = 'activo' and a_modo <> 'activo') or (n_ia and not a_ia and n_modo = 'activo')) and not (p_canal = 'whatsapp' and public._cc_canal_activacion_lista()) then   -- R4-C6 · la compuerta abierta solo vale para WhatsApp
    raise exception 'ACTIVACION_BLOQUEADA: activar el canal o encender la IA requiere completar R4-B2 (pausa en cola y exclusividad IA/humano)' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('rc.canal_origen', 'rpc', true);
  perform set_config('rc.canal_motivo', v_mot, true);
  if p_canal = 'whatsapp' then update public.cc_wa_config set modo = n_modo, ia_habilitada = n_ia, envio_pausado = n_pausa where id;   -- WHERE explícito (safeupdate)
  else update public.cc_meta_config set modo = n_modo, ia_habilitada = n_ia, envio_pausado = n_pausa where canal = p_canal; end if;
  perform set_config('rc.canal_origen', '', true);
  perform set_config('rc.canal_motivo', '', true);

  return jsonb_build_object('cambiado', true, 'canal', p_canal,
    'antes', jsonb_build_object('modo', a_modo, 'ia_habilitada', a_ia, 'envio_pausado', a_pausa),
    'despues', jsonb_build_object('modo', n_modo, 'ia_habilitada', n_ia, 'envio_pausado', n_pausa));
end;
$function$;

do $post$
begin
  if not public._cc_canal_activacion_lista() then raise exception 'R4-C6: la compuerta no quedó abierta'; end if;
  if position('not (p_canal = ''whatsapp'' and public._cc_canal_activacion_lista())' in pg_get_functiondef('public.cc_canal_cambiar(text,jsonb,text)'::regprocedure)) = 0 then raise exception 'R4-C6: cc_canal_cambiar no acota la compuerta a WhatsApp'; end if;
  if current_setting('r4c6.estado_antes') is distinct from (select string_agg(x, ',' order by x) from (select 'whatsapp:' || modo || ':' || ia_habilitada || ':' || envio_pausado x from public.cc_wa_config where id union all select canal || ':' || modo || ':' || ia_habilitada || ':' || envio_pausado from public.cc_meta_config) e) then raise exception 'R4-C6: instalar no debe cambiar el estado de los canales'; end if;
  if exists (select 1 from public.cc_meta_config where modo <> 'espejo' or ia_habilitada) then raise exception 'R4-C6: Instagram y Messenger deben seguir en espejo y sin IA'; end if;
  if has_function_privilege('authenticated', 'public._cc_canal_activacion_lista()', 'execute') or has_function_privilege('anon', 'public._cc_canal_activacion_lista()', 'execute') then raise exception 'R4-C6: privilegios de la compuerta alterados'; end if;
end $post$;
