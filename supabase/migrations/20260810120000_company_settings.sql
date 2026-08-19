-- CONFIGURACIÓN DE EMPRESA (EMISOR). Datos fiscales de la empresa que EMITE el CFDI
-- (razón social, RFC, régimen SAT, CP/lugar de expedición) + identidad (logo, contacto).
-- Hoy Renovacell emite CFDI pero no tiene DÓNDE capturar al emisor; esta tabla es ese hogar
-- y también alimenta encabezados de recibos/manifiestos. Fila única (singleton 'default').
create table if not exists public.company_settings (
  id             text primary key default 'default',
  razon_social   text,
  rfc            text,
  regimen_fiscal text,          -- código SAT c_RegimenFiscal (3 dígitos)
  cp             text,          -- código postal = lugar de expedición del CFDI
  direccion      text,
  telefono       text,
  email          text,
  logo_url       text,
  updated_at     timestamptz not null default now(),
  constraint company_settings_singleton check (id = 'default')
);

alter table public.company_settings enable row level security;

-- Lectura: cualquier usuario autenticado (los recibos/manifiestos muestran al emisor).
drop policy if exists company_settings_read on public.company_settings;
create policy company_settings_read on public.company_settings
  for select using (auth.role() = 'authenticated');

-- Escritura: solo Dirección (datos fiscales sensibles).
drop policy if exists company_settings_write on public.company_settings;
create policy company_settings_write on public.company_settings
  for all using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

-- Fila singleton vacía para editar desde la UI.
insert into public.company_settings (id) values ('default') on conflict (id) do nothing;

do $$
begin
  assert exists (select 1 from pg_tables where tablename = 'company_settings'), 'falta company_settings';
end $$;
