-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CAPTURAR CÉDULA (migración 158) · QUIEN VERIFICA PUEDE CAPTURAR O CORREGIR LA CÉDULA DESDE LA CONVERSACIÓN
--   Decisión del dueño (15 oct 2026): sin SEP ni ninguna integración de verificación; la revisión es de una persona.
--   Si el doctor pasa su cédula por el chat, su vendedor (o Dirección) la captura ahí mismo, sin que el doctor tenga
--   que salir a "Mi verificación". Queda registrado quién la capturó y cuándo.
--   · doctor_capturar_cedula(perfil, cédula)   NUEVA. Solo quien puede verificarlo (_puede_verificar) y solo mientras
--                                               no esté verificado. Deja meta.cedula y meta.cedula_capturada {por, at}.
--   NO cambia: la aprobación, los permisos del perfil para el propio doctor, ni nada de SEP.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/capturar_cedula/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.doctor_capturar_cedula(uuid,text)') is not null then raise exception 'CAPTURAR-CEDULA: ya aplicada'; end if;
  if to_regprocedure('public._puede_verificar(uuid)') is null then raise exception 'CAPTURAR-CEDULA: falta la 154'; end if;
end $pre$;

create function public.doctor_capturar_cedula(p_profile uuid, p_cedula text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_ced text := regexp_replace(btrim(coalesce(p_cedula, '')), '[[:space:]]+', '', 'g'); p record; v_c uuid;
        v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_rol text := public.auth_role();
begin
  if not public._puede_verificar(p_profile) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  if v_ced !~ '^[0-9]{5,12}$' then raise exception 'CEDULA_INVALIDA: escribe solo los números de la cédula (5 a 12 dígitos)' using errcode = 'check_violation'; end if;
  select id, verified, meta into p from public.profiles where id = p_profile and role_id = 'doctor' for update;
  if not found then raise exception 'DOCTOR_INEXISTENTE' using errcode = 'check_violation'; end if;
  if p.verified then raise exception 'YA_VERIFICADO: la cédula de un doctor verificado no se cambia aquí' using errcode = 'check_violation'; end if;
  if p.meta ->> 'cedula' = v_ced then return jsonb_build_object('profile_id', p_profile, 'cedula', v_ced, 'idempotente', true); end if;
  -- `cedula` es una clave protegida del perfil (profiles_guard): la escribe el servidor con app.trusted, y nada más.
  perform set_config('app.trusted', 'on', true);
  update public.profiles
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cedula', v_ced,
                'cedula_capturada', jsonb_build_object('por', auth.uid(), 'rol', case when v_rol = 'admin' then 'direccion' else 'vendedor' end, 'at', now(), 'anterior', p.meta ->> 'cedula'))
   where id = p_profile;
  perform set_config('app.trusted', v_trusted, true);
  select id into v_c from public.customers where profile_id = p_profile limit 1;
  if v_c is not null then perform public._c360_evento(v_c, 'contacto_actualizado', jsonb_build_object('campos', jsonb_build_array('cedula')), case when v_rol = 'admin' then 'direccion' else 'vendedor' end); end if;
  return jsonb_build_object('profile_id', p_profile, 'cedula', v_ced, 'idempotente', false);
end;
$$;
alter function public.doctor_capturar_cedula(uuid, text) owner to postgres;
revoke all on function public.doctor_capturar_cedula(uuid, text) from public, anon;
grant execute on function public.doctor_capturar_cedula(uuid, text) to authenticated, service_role;
