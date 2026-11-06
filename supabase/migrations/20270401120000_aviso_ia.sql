-- AVISO-IA (6 nov 2026) · caso Emanuel: la sucursal está cerrada por remodelación y la IA lo mandaba a ella (solo conocía la
-- dirección y el horario). Dirección escribe un AVISO VIGENTE (con fecha de fin opcional) que la IA lee en cada turno, por
-- WhatsApp y en el portal, y que manda sobre la dirección, el horario y lo de recoger en sucursal.
alter table public.company_settings add column if not exists aviso_ia text;
alter table public.company_settings add column if not exists aviso_ia_hasta date;
alter table public.company_settings drop constraint if exists ck_company_aviso_ia;
alter table public.company_settings add constraint ck_company_aviso_ia check (aviso_ia is null or char_length(aviso_ia) between 5 and 1000);

create or replace function public.ia_aviso_guardar(p_texto text, p_hasta date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if auth.uid() is null or public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if v_texto is not null and char_length(v_texto) < 5 then raise exception 'AVISO_CORTO: escribe el aviso completo' using errcode = 'check_violation'; end if;
  if v_texto is not null and char_length(v_texto) > 1000 then raise exception 'AVISO_LARGO: máximo 1000 caracteres' using errcode = 'check_violation'; end if;
  if v_texto is not null and p_hasta is not null and p_hasta < (now() at time zone 'America/Mazatlan')::date then
    raise exception 'FECHA_PASADA: la fecha de fin ya pasó' using errcode = 'check_violation';
  end if;
  update public.company_settings set aviso_ia = v_texto, aviso_ia_hasta = case when v_texto is null then null else p_hasta end where id = 'default';
  perform public.log_audit('Aviso del asistente', case when v_texto is null then 'quitado' else 'guardado' end,
    coalesce(left(v_texto, 200) || coalesce(' · hasta ' || p_hasta::text, ''), 'sin aviso'), 'Dirección');
  return (select jsonb_build_object('texto', aviso_ia, 'hasta', aviso_ia_hasta) from public.company_settings where id = 'default');
end;
$$;

revoke all on function public.ia_aviso_guardar(text, date) from public, anon;
grant execute on function public.ia_aviso_guardar(text, date) to authenticated;
