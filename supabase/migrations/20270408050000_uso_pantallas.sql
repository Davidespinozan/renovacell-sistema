-- ============================================================================
-- MEDIDOR DE USO DE PANTALLAS (26 nov 2026, auditoría de UX del dueño: «¿de verdad todo está ordenado de la mejor
-- manera?»; Alberto y Toño sienten demasiadas opciones en el menú).
--   · Cuenta, por persona y por día, qué pantalla y qué pestaña abre el personal. Con dos semanas de datos se decide qué
--     va al menú, qué a una pestaña y qué a «Más», sin adivinar.
--   · Solo conteos (no contenido, no clientes). El doctor no se mide. Lo lee Dirección.
--   · `rol` = el rol con el que estaba trabajando (el dueño puede «Ver como…» otro rol).
-- Rollback: drop function public.uso_resumen(integer); drop function public.uso_registrar(text, text, text); drop table public.uso_pantallas;
-- ============================================================================
create table public.uso_pantallas (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  dia date not null,
  rol text not null,
  pantalla text not null,
  pestana text not null default '',
  n integer not null default 1,
  primary key (profile_id, dia, rol, pantalla, pestana)
);
alter table public.uso_pantallas enable row level security;
create policy uso_leer on public.uso_pantallas for select to authenticated using (public.auth_role() = 'admin');
revoke insert, update, delete on public.uso_pantallas from authenticated, anon;
comment on table public.uso_pantallas is 'Conteo diario de pantallas y pestañas abiertas por el personal (para ordenar el menú con datos)';

create function public.uso_registrar(p_pantalla text, p_pestana text default '', p_rol text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_real text := public.auth_role(); v_rol text;
begin
  if auth.uid() is null or v_real is null or v_real = 'doctor' then return; end if;
  if p_pantalla is null or p_pantalla !~ '^[a-z_0-9]{2,40}$' or coalesce(p_pestana, '') !~ '^[a-z_0-9]{0,40}$' then return; end if;
  -- Solo Dirección puede trabajar con otro rol («Ver como…»); cualquier otro se registra con el suyo.
  v_rol := case when v_real = 'admin' and p_rol in ('admin', 'warehouse', 'packing', 'pos', 'driver') then p_rol else v_real end;
  insert into public.uso_pantallas (profile_id, dia, rol, pantalla, pestana) values (auth.uid(), public.hoy_local(), v_rol, p_pantalla, coalesce(p_pestana, ''))
  on conflict (profile_id, dia, rol, pantalla, pestana) do update set n = least(public.uso_pantallas.n + 1, 100000);
end;
$function$;

create function public.uso_resumen(p_dias integer default 14)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('persona', x.persona, 'rol', x.rol, 'pantalla', x.pantalla, 'pestana', x.pestana, 'veces', x.veces, 'dias', x.dias) order by x.persona, x.veces desc)
      from (select coalesce(p.meta ->> 'name', p.full_name, p.email) persona, u.rol, u.pantalla, u.pestana, sum(u.n)::int veces, count(distinct u.dia)::int dias
              from public.uso_pantallas u join public.profiles p on p.id = u.profile_id
             where u.dia >= public.hoy_local() - least(greatest(coalesce(p_dias, 14), 1), 180) and not p.interna
             group by 1, 2, 3, 4) x), '[]'::jsonb);
end;
$function$;
revoke all on function public.uso_registrar(text, text, text) from public, anon;
revoke all on function public.uso_resumen(integer) from public, anon;
grant execute on function public.uso_registrar(text, text, text) to authenticated, service_role;
grant execute on function public.uso_resumen(integer) to authenticated, service_role;
