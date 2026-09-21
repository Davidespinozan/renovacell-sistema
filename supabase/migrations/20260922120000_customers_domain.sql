-- CUSTOMER DOMAIN — separa la IDENTIDAD COMERCIAL del cliente (customers) del ACCESO al portal
-- (profiles/auth). Un customer existe, compra y tiene ubicaciones SIN Auth. Todo ADITIVO y
-- backward-compatible: no toca el PK/FK de profiles, no borra doctor_id, no rompe el portal.

-- 1) Tabla customers (sin FK a auth.users). profile_id enlaza (opcional) una cuenta de portal.
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  email        text,                 -- SIN unique global: hay correos compartidos (clínica/vendedor)
  phone        text,                 -- SIN unique global: teléfonos repetidos conocidos
  city         text,
  country      text,
  seller_name  text,
  external_id  text,                 -- id del sistema origen (Odoo/NUMA); NULL si el archivo no lo trae
  source       text,                 -- 'odoo' | 'numa' | 'manual' | ...
  import_hash  text,                 -- huella estable de la fila importada (idempotencia)
  profile_id   uuid references public.profiles(id) on delete set null,
  meta         jsonb not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Idempotencia POR FUENTE (permite reimportar sin duplicar y sin colisiones entre fuentes):
create unique index if not exists uq_customers_source_external
  on public.customers(source, external_id) where (external_id is not null);
create unique index if not exists uq_customers_source_import_hash
  on public.customers(source, import_hash) where (import_hash is not null);
-- Una cuenta de portal (profile) enlaza a lo sumo UN customer:
create unique index if not exists uq_customers_profile
  on public.customers(profile_id) where (profile_id is not null);
-- Búsqueda (no únicos):
create index if not exists idx_customers_email on public.customers(lower(email)) where (email is not null);
create index if not exists idx_customers_phone on public.customers(phone) where (phone is not null);
create index if not exists idx_customers_seller on public.customers(seller_name);

alter table public.customers enable row level security;

-- SELECT: admin y pos (operación); el doctor SOLO su propio customer (profile enlazado).
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using ( public.auth_role() = any (array['admin','pos']) or profile_id = auth.uid() );
-- Escritura: SOLO admin (el importador corre como admin/service).
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check ( public.auth_role() = 'admin' );
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using ( public.auth_role() = 'admin' ) with check ( public.auth_role() = 'admin' );
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete to authenticated
  using ( public.auth_role() = 'admin' );

-- 2) PEDIDOS: identidad comercial opcional, sin perder doctor_id (portal/legacy).
alter table public.orders add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists idx_orders_customer on public.orders(customer_id);

-- 3) UBICACIONES: soportar customer sin Auth SIN destruir doctor_locations.
--    Se ancla por doctor_id (portal, como hasta ahora) O por customer_id (sin Auth).
alter table public.doctor_locations add column if not exists customer_id uuid references public.customers(id) on delete cascade;
alter table public.doctor_locations alter column doctor_id drop not null;
-- Cada fila debe tener AL MENOS un ancla:
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_doctor_locations_anchor') then
    alter table public.doctor_locations
      add constraint ck_doctor_locations_anchor check (doctor_id is not null or customer_id is not null);
  end if;
end $$;
create index if not exists idx_doctor_locations_customer on public.doctor_locations(customer_id);
-- Máximo UNA default activa por customer (equivalente al índice por doctor de Fase 1):
create unique index if not exists uq_doctor_locations_customer_default
  on public.doctor_locations(customer_id) where (is_default = true and active = true and customer_id is not null);

-- RLS de ubicaciones: además del doctor dueño (doctor_id=uid), el dueño VÍA CUSTOMER enlazado.
drop policy if exists doctor_locations_select on public.doctor_locations;
create policy doctor_locations_select on public.doctor_locations for select to authenticated
  using (
    doctor_id = auth.uid()
    or public.auth_role() = any (array['admin','pos'])
    or (customer_id is not null and exists (select 1 from public.customers c where c.id = doctor_locations.customer_id and c.profile_id = auth.uid()))
  );
drop policy if exists doctor_locations_insert on public.doctor_locations;
create policy doctor_locations_insert on public.doctor_locations for insert to authenticated
  with check (
    doctor_id = auth.uid()
    or public.auth_role() = 'admin'
    or (customer_id is not null and exists (select 1 from public.customers c where c.id = doctor_locations.customer_id and c.profile_id = auth.uid()))
  );
drop policy if exists doctor_locations_update on public.doctor_locations;
create policy doctor_locations_update on public.doctor_locations for update to authenticated
  using (
    doctor_id = auth.uid()
    or public.auth_role() = 'admin'
    or (customer_id is not null and exists (select 1 from public.customers c where c.id = doctor_locations.customer_id and c.profile_id = auth.uid()))
  )
  with check (
    doctor_id = auth.uid()
    or public.auth_role() = 'admin'
    or (customer_id is not null and exists (select 1 from public.customers c where c.id = doctor_locations.customer_id and c.profile_id = auth.uid()))
  );
-- DELETE físico: solo admin (sin cambio).
drop policy if exists doctor_locations_delete on public.doctor_locations;
create policy doctor_locations_delete on public.doctor_locations for delete to authenticated
  using ( public.auth_role() = 'admin' );

-- Cambio ATÓMICO de default: ahora soporta ancla por doctor O por customer. El id se deriva de la
-- fila; autoriza admin, dueño doctor (doctor_id=uid) o dueño vía customer (customers.profile_id=uid).
create or replace function public.set_doctor_default_location(p_location_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_doctor uuid; v_customer uuid; v_active boolean; v_owner boolean;
begin
  select doctor_id, customer_id, active into v_doctor, v_customer, v_active
    from public.doctor_locations where id = p_location_id;
  if not found then raise exception 'UBICACION_INEXISTENTE'; end if;
  if v_active is not true then raise exception 'UBICACION_INACTIVA: una ubicación inactiva no puede ser predeterminada'; end if;
  v_owner := (auth.uid() = v_doctor)
          or (v_customer is not null and exists (select 1 from public.customers c where c.id = v_customer and c.profile_id = auth.uid()));
  if not (public.auth_role() = 'admin' or v_owner) then
    raise exception 'NO_AUTORIZADO: solo el doctor dueño, el customer dueño o Administración';
  end if;
  if v_customer is not null then
    update public.doctor_locations set is_default = (id = p_location_id), updated_at = now()
     where customer_id = v_customer and active = true;
  else
    update public.doctor_locations set is_default = (id = p_location_id), updated_at = now()
     where doctor_id = v_doctor and active = true;
  end if;
end; $$;
revoke all on function public.set_doctor_default_location(uuid) from public, anon;
grant execute on function public.set_doctor_default_location(uuid) to authenticated;

-- SELF-TEST: aborta el deploy si falta algo del dominio.
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='customers') then
    raise exception 'customers: falta la tabla'; end if;
  if exists (select 1 from pg_indexes where schemaname='public' and tablename='customers' and indexdef ilike '%(email)%' and indexdef ilike '%unique%') then
    raise exception 'customers: email NO debe ser único'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_customers_source_external') then
    raise exception 'customers: falta índice idempotente (source, external_id)'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_customers_source_import_hash') then
    raise exception 'customers: falta índice idempotente (source, import_hash)'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_customers_profile') then
    raise exception 'customers: falta unicidad de profile_id'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='customers') < 4 then
    raise exception 'customers: faltan políticas RLS'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='customer_id') then
    raise exception 'orders: falta customer_id'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='doctor_locations' and column_name='customer_id') then
    raise exception 'doctor_locations: falta customer_id'; end if;
  if not exists (select 1 from pg_constraint where conname='ck_doctor_locations_anchor') then
    raise exception 'doctor_locations: falta el CHECK de ancla'; end if;
  if (select is_nullable from information_schema.columns where table_schema='public' and table_name='doctor_locations' and column_name='doctor_id') <> 'YES' then
    raise exception 'doctor_locations: doctor_id debe ser nullable'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_doctor_locations_customer_default') then
    raise exception 'doctor_locations: falta índice de default por customer'; end if;
end $$;
