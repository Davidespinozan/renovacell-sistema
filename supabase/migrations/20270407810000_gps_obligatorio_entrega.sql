-- GPS EN LA ENTREGA (23 nov 2026) · 3 entregas de hoy sin un solo punto: el Android del chofer nunca dio permiso de
-- ubicación y en la oficina nadie se enteró. Dueño: «dale» a (1) pedir la ubicación al marcar entregado, con «Entregar
-- sin ubicación» + motivo como último recurso, y (2) avisar en «Choferes en ruta» cuando el chofer trae la ubicación apagada.

-- 1) Estado del GPS de cada chofer (lo reporta su teléfono al cambiar: activo / denegado / no_disponible).
create table if not exists public.chofer_gps_estado (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  estado text not null check (estado in ('activo', 'denegado', 'no_disponible')),
  desde timestamptz not null default now(),
  at timestamptz not null default now()
);
alter table public.chofer_gps_estado enable row level security;   -- solo por las funciones de abajo

create or replace function public.chofer_gps_reportar(p_estado text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if public.auth_role() <> 'driver' then return 'no_aplica'; end if;   -- nunca frena a nadie
  if p_estado not in ('activo', 'denegado', 'no_disponible') then return 'invalido'; end if;
  insert into public.chofer_gps_estado (driver_id, estado, desde, at) values (auth.uid(), p_estado, now(), now())
  on conflict (driver_id) do update set desde = case when public.chofer_gps_estado.estado = excluded.estado then public.chofer_gps_estado.desde else now() end,
                                        estado = excluded.estado, at = now();
  return 'ok';
end;
$$;
revoke all on function public.chofer_gps_reportar(text) from public, anon;
grant execute on function public.chofer_gps_reportar(text) to authenticated;

-- 2) Entregas cerradas SIN ubicación (con su motivo): evidencia que la oficina puede revisar.
create table if not exists public.entregas_sin_ubicacion (
  shipment_id uuid primary key references public.shipments(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  motivo text not null check (length(btrim(motivo)) >= 5),
  at timestamptz not null default now()
);
alter table public.entregas_sin_ubicacion enable row level security;

create or replace function public.entrega_sin_ubicacion(p_shipment uuid, p_motivo text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if public.auth_role() <> 'driver' then raise exception 'NO_AUTORIZADO: solo el chofer' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.shipments s where s.id = p_shipment and s.driver_id = auth.uid()) then
    raise exception 'NO_AUTORIZADO: esa entrega no es tuya' using errcode = 'insufficient_privilege'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'MOTIVO_REQUERIDO: escribe por qué no hay ubicación' using errcode = 'check_violation'; end if;
  insert into public.entregas_sin_ubicacion (shipment_id, driver_id, motivo) values (p_shipment, auth.uid(), left(btrim(p_motivo), 300))
  on conflict (shipment_id) do update set motivo = excluded.motivo, at = now();
  return 'ok';
end;
$$;
revoke all on function public.entrega_sin_ubicacion(uuid, text) from public, anon;
grant execute on function public.entrega_sin_ubicacion(uuid, text) to authenticated;

-- 3) Para la oficina (mismos roles que el mapa): GPS de cada chofer en ruta + entregas de hoy sin ubicación.
create or replace function public.choferes_gps_estado() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.auth_role() = any (array['admin', 'warehouse', 'packing'])) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'gps', coalesce((select jsonb_agg(jsonb_build_object('driver_id', g.driver_id, 'estado', g.estado, 'desde', g.desde, 'at', g.at))
                       from public.chofer_gps_estado g), '[]'::jsonb),
    'sin_ubicacion', coalesce((select jsonb_agg(jsonb_build_object('shipment_id', e.shipment_id, 'driver_id', e.driver_id, 'motivo', e.motivo, 'at', e.at,
                                  'folio', (select o.external_ref from public.shipments s join public.orders o on o.id = s.order_id where s.id = e.shipment_id)) order by e.at desc)
                                 from public.entregas_sin_ubicacion e where e.at >= (public.hoy_local()::timestamp at time zone 'America/Mazatlan')), '[]'::jsonb));
end;
$$;
revoke all on function public.choferes_gps_estado() from public, anon;
grant execute on function public.choferes_gps_estado() to authenticated;
