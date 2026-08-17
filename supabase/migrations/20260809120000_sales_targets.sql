-- METAS Y COMISIONES DE VENDEDOR. Tabla de metas (cuota mensual) por vendedor y la tasa
-- de comisión global. La fila especial seller='__default__' guarda los valores por defecto
-- (tasa de comisión del equipo + meta base para vendedores nuevos). Solo Dirección la ve/edita.
create table if not exists public.sales_targets (
  seller          text primary key,            -- email del vendedor, o '__default__'
  target          numeric not null default 0,  -- meta de venta del periodo (mensual)
  commission_rate numeric not null default 0.05,
  updated_at      timestamptz not null default now()
);

alter table public.sales_targets enable row level security;

-- Solo Dirección (admin) lee y escribe: son cifras sensibles (metas, comisiones).
drop policy if exists sales_targets_admin_all on public.sales_targets;
create policy sales_targets_admin_all on public.sales_targets
  for all using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

-- Valores por defecto del equipo (5% de comisión, sin meta base) si no existen aún.
insert into public.sales_targets (seller, target, commission_rate)
values ('__default__', 0, 0.05)
on conflict (seller) do nothing;

do $$
begin
  assert exists (select 1 from pg_tables where tablename = 'sales_targets'), 'falta la tabla sales_targets';
end $$;
