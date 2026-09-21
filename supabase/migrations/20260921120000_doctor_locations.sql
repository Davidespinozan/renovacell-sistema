-- Multi-ubicación de entrega por doctor (Fase 1). Catálogo PERSISTENTE de domicilios; NO altera
-- orders ni el snapshot shipping_meta (la dirección elegida se sigue copiando al pedido en fase 2).
-- Separado de meta.fiscal (CFDI): esto es SOLO entrega. 'references' es reservada en SQL →
-- se usa la columna 'reference_notes'.
create table if not exists public.doctor_locations (
  id               uuid primary key default gen_random_uuid(),
  doctor_id        uuid not null references public.profiles(id) on delete cascade,
  name             text not null,               -- alias: "Clínica Centro", "Consultorio Norte"
  line1            text not null,               -- calle
  exterior_number  text,
  interior_number  text,
  neighborhood     text,                        -- colonia
  postal_code      text not null,
  city             text not null,
  state            text not null,
  country          text not null default 'México',
  reference_notes  text,                        -- referencias / entre calles ('references' es reservada)
  contact_name     text,
  contact_phone    text,
  is_default       boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_doctor_locations_doctor on public.doctor_locations(doctor_id);

-- A NIVEL DB: como máximo UNA ubicación default ACTIVA por doctor (evita estados inconsistentes;
-- también hace que dos setDefault concurrentes choquen con violación de unicidad en vez de dejar
-- dos defaults). Una ubicación inactiva nunca cuenta como default utilizable.
create unique index if not exists uq_doctor_locations_one_default
  on public.doctor_locations(doctor_id) where (is_default = true and active = true);

alter table public.doctor_locations enable row level security;

-- SELECT: el doctor dueño, admin y pos (Ventas levanta pedidos "a nombre de").
drop policy if exists doctor_locations_select on public.doctor_locations;
create policy doctor_locations_select on public.doctor_locations for select to authenticated
  using ( doctor_id = auth.uid() or public.auth_role() = any (array['admin','pos']) );

-- INSERT: el doctor solo para SÍ mismo; admin para cualquiera.
drop policy if exists doctor_locations_insert on public.doctor_locations;
create policy doctor_locations_insert on public.doctor_locations for insert to authenticated
  with check ( doctor_id = auth.uid() or public.auth_role() = 'admin' );

-- UPDATE: el doctor solo las suyas; admin cualquiera.
drop policy if exists doctor_locations_update on public.doctor_locations;
create policy doctor_locations_update on public.doctor_locations for update to authenticated
  using ( doctor_id = auth.uid() or public.auth_role() = 'admin' )
  with check ( doctor_id = auth.uid() or public.auth_role() = 'admin' );

-- DELETE físico: solo admin. La app usa soft-delete (active=false) desde la UI.
drop policy if exists doctor_locations_delete on public.doctor_locations;
create policy doctor_locations_delete on public.doctor_locations for delete to authenticated
  using ( public.auth_role() = 'admin' );

-- Cambio ATÓMICO de ubicación default. Recibe SOLO p_location_id; el doctor_id se DERIVA de la
-- fila objetivo (nunca del cliente). Un único UPDATE deja exactamente UNA default activa: la
-- elegida (is_default = (id = p_location_id) sobre las activas del doctor). El índice único
-- parcial queda como segunda defensa. SECURITY DEFINER para actualizar las filas hermanas de
-- forma atómica; la autorización se valida DENTRO.
create or replace function public.set_doctor_default_location(p_location_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_doctor uuid; v_active boolean;
begin
  select doctor_id, active into v_doctor, v_active from public.doctor_locations where id = p_location_id;
  if v_doctor is null then raise exception 'UBICACION_INEXISTENTE'; end if;
  if v_active is not true then raise exception 'UBICACION_INACTIVA: una ubicación inactiva no puede ser predeterminada'; end if;
  -- Solo el DOCTOR dueño o ADMIN. POS puede leer pero NO cambiar defaults.
  if not (auth.uid() = v_doctor or public.auth_role() = 'admin') then
    raise exception 'NO_AUTORIZADO: solo el doctor dueño o Administración';
  end if;
  update public.doctor_locations
     set is_default = (id = p_location_id), updated_at = now()
   where doctor_id = v_doctor and active = true;
end; $$;
revoke all on function public.set_doctor_default_location(uuid) from public, anon;
grant execute on function public.set_doctor_default_location(uuid) to authenticated;

-- SELF-TEST: aborta el deploy si falta el índice de default, las políticas o la RPC.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_doctor_locations_one_default') then
    raise exception 'doctor_locations: falta el índice único de default';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='doctor_locations') < 4 then
    raise exception 'doctor_locations: faltan políticas RLS (esperadas 4)';
  end if;
  if not exists (select 1 from pg_proc where proname = 'set_doctor_default_location') then
    raise exception 'doctor_locations: falta la RPC set_doctor_default_location';
  end if;
end $$;
