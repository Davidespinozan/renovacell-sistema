-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- MI VERIFICACIÓN (migración 155) · EL DOCTOR SABE EN QUÉ VA SU VERIFICACIÓN Y PUEDE CORREGIRLA
--   · mi_verificacion()        NUEVA (el propio doctor). Su estado: pendiente, aprobado o rechazado (con el motivo),
--                              y qué le falta (cédula, INE frente, INE reverso). El portal la consulta sola y, al
--                              aprobarse, desbloquea precios sin volver a iniciar sesión.
--   · doctor_verificar         un cambio: el motivo se guarda como `reason` (la misma clave que usa Dirección) y avisa
--                              al doctor dentro del sistema al aprobar o rechazar.
--   La corrección de datos (cédula y fotos del INE) la recibe la Edge `verificacion` (acción `completar`), que sube
--   las fotos con service_role a proofs/identity/<perfil>/ y deja la verificación otra vez en revisión.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/mi_verificacion/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.mi_verificacion()') is not null then raise exception 'MI-VERIFICACION: ya aplicada'; end if;
  if md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) <> '8cf4dbc5e9e32d09f5b125f51d92c6ad' then raise exception 'MI-VERIFICACION: doctor_verificar no es la versión auditada'; end if;
end $pre$;

create function public.mi_verificacion() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
-- Solo lo del propio doctor. Rechazado = el último dictamen fue 'rejected' (Dirección o vendedor) y sigue sin acceso.
declare p record; ev jsonb;
begin
  select id, role_id, verified, meta into p from public.profiles where id = auth.uid();
  if not found or p.role_id <> 'doctor' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  ev := coalesce(p.meta -> 'identity' -> 'evidence', '{}'::jsonb);
  return jsonb_build_object(
    'verificado', p.verified,
    'estado', case when p.verified then 'verified' when p.meta -> 'verification' ->> 'status' in ('rejected', 'revoked') then p.meta -> 'verification' ->> 'status' else 'pending' end,
    'motivo', case when not p.verified then p.meta -> 'verification' ->> 'reason' end,
    'revisado_at', p.meta -> 'verification' ->> 'reviewed_at',
    'cedula', p.meta ->> 'cedula',
    'faltan', to_jsonb(array_remove(array[
        case when nullif(btrim(coalesce(p.meta ->> 'cedula', '')), '') is null then 'cedula' end,
        case when not ev ? 'ine-front' then 'ine-front' end,
        case when not ev ? 'ine-back' then 'ine-back' end], null)));
end;
$$;
alter function public.mi_verificacion() owner to postgres;
revoke all on function public.mi_verificacion() from public, anon;
grant execute on function public.mi_verificacion() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.doctor_verificar(p_profile uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Aprueba o rechaza la verificación de un doctor. Aprobar = su expediente de cliente queda ligado (el que ya tenía,
-- el único con su mismo correo sin cuenta, o uno nuevo) y la cuenta se verifica. Quién lo aprobó queda registrado.
declare p record; v_c uuid; v_nota text := nullif(btrim(left(coalesce(p_nota, ''), 300)), ''); v_rol text := public.auth_role();
        v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_n int;
begin
  if not public._puede_verificar(p_profile) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  if p_aprobar is null then raise exception 'DECISION_INVALIDA' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_profile::text));
  select id, full_name, email, verified, meta into p from public.profiles where id = p_profile and role_id = 'doctor' for update;
  if not found then raise exception 'DOCTOR_INEXISTENTE' using errcode = 'check_violation'; end if;
  if p.verified then return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'idempotente', true); end if;
  if not p_aprobar then
    if v_nota is null then raise exception 'NOTA_REQUERIDA: explica por qué se rechaza' using errcode = 'check_violation'; end if;
    perform set_config('app.trusted', 'on', true);
    update public.profiles set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'rejected', 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'reason', v_nota)) where id = p_profile;
    perform set_config('app.trusted', v_trusted, true);
    select id into v_c from public.customers where profile_id = p_profile limit 1;
    if v_c is not null then perform public._c360_evento(v_c, 'verificacion_rechazada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end); end if;
    -- Aviso al doctor dentro del sistema (el portal además lo detecta solo): el motivo lo ve en "Mi verificación".
    perform public._cc_notificar('verificacion_rechazada', null, array[p_profile], null, 'Tu verificación no fue aprobada: ' || v_nota || '. Corrige tus datos en "Mi verificación".', 'mi_verificacion', 'verif_rechazo:' || p_profile::text || ':' || extract(epoch from now())::bigint::text);
    return jsonb_build_object('profile_id', p_profile, 'verificado', false, 'estado', 'rejected');
  end if;
  select id into v_c from public.customers where profile_id = p_profile order by active desc, created_at limit 1;
  if v_c is null and p.email is not null then
    select count(*), min(id::text)::uuid into v_n, v_c from public.customers where profile_id is null and active and lower(btrim(email)) = lower(btrim(p.email));
    if v_n <> 1 then v_c := null; end if;
    if v_c is not null then update public.customers set profile_id = p_profile, updated_at = now() where id = v_c; end if;
  end if;
  if v_c is null then
    insert into public.customers (full_name, email, phone, city, source, profile_id, active)
    values (coalesce(nullif(p.full_name, ''), p.meta ->> 'name', 'Doctor'), p.email, nullif(p.meta -> 'shipping' ->> 'phone', ''), nullif(p.meta -> 'shipping' ->> 'city', ''), 'portal', p_profile, true)
    returning id into v_c;
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.profiles set verified = true,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'verified', 'via', case when v_rol = 'admin' then 'direccion' else 'vendedor' end, 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'reason', v_nota))
   where id = p_profile;
  perform set_config('app.trusted', v_trusted, true);
  if v_rol = 'pos' and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_profile, auth.uid(), now(), auth.uid(), 'Lo verificó su vendedor');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_profile, null, auth.uid(), auth.uid(), 'Lo verificó su vendedor');
  end if;
  perform public._c360_evento(v_c, 'verificacion_aprobada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  perform public._cc_notificar('verificacion_aprobada', null, array[p_profile], null, 'Tu cuenta Renovacell fue verificada: ya puedes ver precios y hacer pedidos.', 'catalogo', 'verif_ok:' || p_profile::text);
  return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'customer_id', v_c, 'idempotente', false);
end;
$function$;

do $post$ begin
  if md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) <> '2125839d158c065129007966c969a4f9' then raise exception 'MI-VERIFICACION: doctor_verificar no quedó con la definición esperada'; end if;
  if has_function_privilege('anon', 'public.mi_verificacion()', 'execute') then raise exception 'MI-VERIFICACION: permisos inesperados'; end if;
end $post$;
