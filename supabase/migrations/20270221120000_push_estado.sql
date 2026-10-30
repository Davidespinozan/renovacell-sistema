-- ============================================================================
-- PUSH SIEMPRE (30 oct 2026) · Dirección ve quién tiene las notificaciones activas y en cuántos dispositivos (Equipo y
-- Doctores), para pedirle a quien falte que las active. Solo cuenta dispositivos activos; nunca expone las direcciones.
-- ============================================================================
create or replace function public.push_estado_cuentas() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_object_agg(profile_id, jsonb_build_object('dispositivos', n, 'ultimo_ok', ultimo))
    from (select s.profile_id, count(*) n, max(s.ultimo_ok_at) ultimo from public.push_suscripciones s
           where s.activo and s.profile_id is not null group by s.profile_id) x), '{}'::jsonb);
end;
$$;
alter function public.push_estado_cuentas() owner to postgres;
revoke all on function public.push_estado_cuentas() from public, anon;
grant execute on function public.push_estado_cuentas() to authenticated;
