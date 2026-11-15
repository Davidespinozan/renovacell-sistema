-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO DE SESIÓN (15 nov 2026, equipo: "nos está sacando de la sesión constantemente").
--   La app anota en el dispositivo cada salida que la persona NO pidió (perfil que no cargó, sesión perdida, cierre
--   desde el servidor) y la sube aquí en cuanto vuelve a entrar. Solo lectura del personal técnico (sin políticas).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.sesion_diagnosticos') is not null then raise exception 'SESION-DIAG: ya aplicada'; end if;
end $pre$;

create table public.sesion_diagnosticos (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  evento      text not null check (evento ~ '^[a-z_]{3,40}$'),
  detalle     text check (length(detalle) <= 300),
  ocurrido_at timestamptz not null,
  dispositivo text check (length(dispositivo) <= 200),
  created_at  timestamptz not null default now()
);
create index ix_sesion_diag_perfil on public.sesion_diagnosticos (profile_id, ocurrido_at desc);
alter table public.sesion_diagnosticos enable row level security;
revoke all on table public.sesion_diagnosticos from public, anon, authenticated;

create function public.sesion_diagnostico_registrar(p_eventos jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); n integer;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if jsonb_typeof(p_eventos) <> 'array' then return 0; end if;
  insert into public.sesion_diagnosticos (profile_id, evento, detalle, ocurrido_at, dispositivo)
  select v_uid, e ->> 'evento', left(e ->> 'detalle', 300),
         least(greatest(coalesce((e ->> 'at')::timestamptz, now()), now() - interval '30 days'), now()), left(e ->> 'dispositivo', 200)
    from jsonb_array_elements(p_eventos) with ordinality x(e, i)
   where i <= 20 and coalesce(e ->> 'evento', '') ~ '^[a-z_]{3,40}$';
  get diagnostics n = row_count;
  return n;
end;
$$;
alter function public.sesion_diagnostico_registrar(jsonb) owner to postgres;
revoke all on function public.sesion_diagnostico_registrar(jsonb) from public, anon;
grant execute on function public.sesion_diagnostico_registrar(jsonb) to authenticated;
