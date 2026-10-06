-- ============================================================================
-- CC-1 · ROLLBACK. Retira el dominio de visitante y devuelve el dedupe de prospectos a su
-- versión CC-0B (dígitos íntegros ≥ 7). No hay datos de negocio en juego: cc_visitors solo
-- guarda hashes y atribución anónima; prospects.visitor_id se pierde (era aditivo).
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
drop function if exists public.cc_codigo_referido_revocar(text);
drop function if exists public.cc_codigo_referido_crear(uuid);
drop function if exists public.cc_visitantes_purgar(int);
drop function if exists public.cc_visitante_adoptar(text, uuid);
drop function if exists public.cc_visitante_prospecto(text, uuid);
drop function if exists public.cc_visitante_vincular_registro(text, uuid);
drop function if exists public.cc_visitante_abrir(text, text, jsonb, text);
alter table public.prospects drop column if exists visitor_id;
drop table if exists public.cc_visitor_events;
drop table if exists public.cc_referral_codes;
drop table if exists public.cc_visitors;
drop function if exists public._cc_append_only();
drop function if exists public._cc_atribuible(jsonb);
drop function if exists public._cc_attr_limpia(jsonb);

-- Dedupe CC-0B (texto previo) + su índice.
drop index if exists public.idx_prospects_phone_norm;
create index if not exists idx_prospects_phone_digits
  on public.prospects (regexp_replace(phone, '[^0-9]', '', 'g')) where phone is not null;
create or replace function public.buscar_prospecto_duplicado(p_email text, p_phone text) returns uuid
  language sql stable security definer set search_path = public as
$$
  select p.id from public.prospects p
   where (nullif(lower(trim(coalesce(p_email, ''))), '') is not null and lower(p.email) = lower(trim(p_email)))
      or (length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 7
          and regexp_replace(p.phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g'))
   order by p.created_at asc
   limit 1;
$$;
revoke all on function public.buscar_prospecto_duplicado(text, text) from public, anon, authenticated;
grant execute on function public.buscar_prospecto_duplicado(text, text) to service_role;
drop function if exists public.norm_telefono_mx(text);
