-- ============================================================================
-- W1 · BASE LIMPIA TRANSACCIONAL — SCRIPT OPERATIVO (NO es una migración).
--
-- ⚠️ EJECUTAR SOLO CON AUTORIZACIÓN EXPLÍCITA DE DAVID, en la ventana P4, con
--    congelamiento operativo y un punto de recuperación VERIFICADO.
--
-- Qué hace (todo en UNA transacción; cualquier discrepancia ⇒ ROLLBACK total):
--   1. Se niega a correr si W1 ya está aplicado (debe ir ANTES de M1).
--   2. Congela las tablas operativas (LOCK) y compara contra el MANIFIESTO EXACTO
--      confirmado por el dueño (D-01): mismos ids, mismos conteos, nada más.
--   3. Toma una fotografía de conteos de datos MAESTROS (doctores, productos,
--      precios/costos, customers, auth, etc.).
--   4. Archiva las filas de prueba en el esquema `w1_archive` (sin acceso de API).
--   5. Purga con el escape administrativo EXISTENTE `renovacell.purge` (SET LOCAL),
--      en orden de FK: kardex → renglones → pedidos → lotes.
--   6. Verifica: operativos en 0, maestros IDÉNTICOS; deja constancia en audit_logs.
--
-- Re-ejecución segura: si ya corrió, el esquema w1_archive existe y el manifiesto no
-- coincide ⇒ aborta sin tocar nada. Si aparece cualquier dato real nuevo ⇒ aborta.
-- NO toca: products*, price_lists, product_costs, profiles, auth.users, customers,
-- doctor_locations, prospects, audit_logs (solo agrega 1 registro), notifications,
-- storage.objects (el comprobante de S565051 se trata aparte), company_*.
--
-- Uso: psql -X -v ON_ERROR_STOP=1 -f supabase/ops/w1_base_limpia.sql
--      (el archivo trae su propio BEGIN/COMMIT; NO usar -1)
-- ============================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.inventory_operations') is not null then
    raise exception 'W1_BASE_LIMPIA_ABORT: W1 ya está aplicado (existe inventory_operations). Este script solo corre ANTES de M1.';
  end if;
  if to_regnamespace('w1_archive') is not null then
    raise exception 'W1_BASE_LIMPIA_ABORT: el esquema w1_archive ya existe (¿ya se ejecutó?). No se re-ejecuta.';
  end if;
end
$guard$;

-- Congela escrituras concurrentes sobre el dominio operativo mientras se verifica y purga.
lock table public.orders, public.order_items, public.lots, public.inventory_movements,
           public.shipments, public.shipping_attempts, public.refunds, public.replenishments,
           public.events, public.consignment_stock, public.cash_closings
  in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- MANIFIESTO EXACTO (producción, verificado en solo lectura 2026-09-28)
-- ---------------------------------------------------------------------------
create temp table w1_manifest (tbl text not null, id uuid not null, descr text not null) on commit drop;
insert into w1_manifest values
  ('orders',              '01812c70-82ff-4479-87bc-0757ab9f592b', 'QA-DHL-E2E (packed, sin renglones)'),
  ('orders',              '826cad23-1290-406b-9eb2-2fd6e1a180fe', 'S565051'),
  ('orders',              '52d58834-336c-4c4a-a3df-84ba2bc99506', 'S958883'),
  ('order_items',         '8d775ab6-cc5b-4b9e-8959-652be6e61bfd', 'S565051 · 2 u · lote 234234233'),
  ('order_items',         '97288a3b-159a-447e-b5c2-33514562f6a1', 'S958883 · 10 u · lote adasda'),
  ('lots',                'eeeccd41-96e7-4579-a06a-2e165253d052', '234234233 (10 u)'),
  ('lots',                '99655e42-07b3-4651-ace3-e0503cd1063b', 'adasda (0 u)'),
  ('lots',                'ddc5941d-1c59-4f44-96ba-75db5060e7eb', 'dsfsdfsdfsd (12 u, caducado)'),
  ('inventory_movements', 'c59e431c-e1d6-4a48-a058-4f54396641c1', 'entrada 234234233 +12'),
  ('inventory_movements', '3de29637-29f2-4656-8dab-deaf72165635', 'surtido S565051 -2'),
  ('inventory_movements', 'd9f0b3b2-b377-4910-969b-9c9c9db858d4', 'entrada adasda +10'),
  ('inventory_movements', '1f35aacd-be3e-4c89-b579-f8867c1fc8cb', 'surtido S958883 -10'),
  ('inventory_movements', 'd5705b77-3978-4431-9710-420a8d8394ff', 'entrada dsfsdfsdfsd +12');

do $check$
declare n_extra int; n_missing int; r record;
begin
  -- Cada tabla del manifiesto: EXACTAMENTE esos ids (ni uno más, ni uno menos).
  for r in select * from (values ('orders'), ('order_items'), ('lots'), ('inventory_movements')) v(tbl) loop
    execute format('select count(*) from public.%I t where t.id not in (select id from w1_manifest where tbl = %L)', r.tbl, r.tbl) into n_extra;
    execute format('select count(*) from w1_manifest m where m.tbl = %L and not exists (select 1 from public.%I t where t.id = m.id)', r.tbl, r.tbl) into n_missing;
    if n_extra > 0 or n_missing > 0 then
      raise exception 'W1_BASE_LIMPIA_ABORT: % no coincide con el manifiesto (filas nuevas: %, faltantes: %). No se toca nada.', r.tbl, n_extra, n_missing;
    end if;
  end loop;
  -- Tablas operativas que deben estar VACÍAS.
  for r in select * from (values ('replenishments'), ('refunds'), ('shipments'), ('shipping_attempts'),
                                 ('events'), ('consignment_stock'), ('cash_closings')) v(tbl) loop
    execute format('select count(*) from public.%I', r.tbl) into n_extra;
    if n_extra > 0 then
      raise exception 'W1_BASE_LIMPIA_ABORT: % tiene % fila(s); el manifiesto exige 0. No se toca nada.', r.tbl, n_extra;
    end if;
  end loop;
end
$check$;

-- ---------------------------------------------------------------------------
-- FOTOGRAFÍA DE DATOS MAESTROS (deben quedar IDÉNTICOS)
-- ---------------------------------------------------------------------------
create temp table w1_masters on commit drop as
select 'products' k, (select count(*) from public.products) n
union all select 'product_prices', (select count(*) from public.product_prices)
union all select 'product_volume_prices', (select count(*) from public.product_volume_prices)
union all select 'product_costs', (select count(*) from public.product_costs)
union all select 'price_lists', (select count(*) from public.price_lists)
union all select 'profiles', (select count(*) from public.profiles)
union all select 'profiles_doctor', (select count(*) from public.profiles where role_id = 'doctor')
union all select 'auth_users', (select count(*) from auth.users)
union all select 'customers', (select count(*) from public.customers)
union all select 'doctor_locations', (select count(*) from public.doctor_locations)
union all select 'prospects', (select count(*) from public.prospects)
union all select 'notifications', (select count(*) from public.notifications)
union all select 'storage_objects', (select count(*) from storage.objects)
union all select 'company_settings', (select count(*) from public.company_settings)
union all select 'company_bank_accounts', (select count(*) from public.company_bank_accounts)
union all select 'audit_logs', (select count(*) from public.audit_logs);

-- ---------------------------------------------------------------------------
-- ARCHIVO (copia íntegra, sin acceso de los roles de la API)
-- ---------------------------------------------------------------------------
create schema w1_archive;
revoke all on schema w1_archive from public;
do $revoke$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema w1_archive from %I', r);
    end if;
  end loop;
end
$revoke$;
create table w1_archive.orders              as select * from public.orders              where id in (select id from w1_manifest where tbl = 'orders');
create table w1_archive.order_items         as select * from public.order_items         where id in (select id from w1_manifest where tbl = 'order_items');
create table w1_archive.lots                as select * from public.lots                where id in (select id from w1_manifest where tbl = 'lots');
create table w1_archive.inventory_movements as select * from public.inventory_movements where id in (select id from w1_manifest where tbl = 'inventory_movements');
create table w1_archive.manifest            as select *, now() as archived_at, current_user as archived_by from w1_manifest;

-- ---------------------------------------------------------------------------
-- PURGA (escape administrativo existente, SOLO en esta transacción)
-- ---------------------------------------------------------------------------
set local renovacell.purge = 'on';
do $purge$
declare n int;
begin
  delete from public.inventory_movements where id in (select id from w1_manifest where tbl = 'inventory_movements');
  get diagnostics n = row_count; if n <> 5 then raise exception 'W1_BASE_LIMPIA_ABORT: kardex borró % (esperado 5)', n; end if;
  delete from public.order_items where id in (select id from w1_manifest where tbl = 'order_items');
  get diagnostics n = row_count; if n <> 2 then raise exception 'W1_BASE_LIMPIA_ABORT: renglones borró % (esperado 2)', n; end if;
  delete from public.orders where id in (select id from w1_manifest where tbl = 'orders');
  get diagnostics n = row_count; if n <> 3 then raise exception 'W1_BASE_LIMPIA_ABORT: pedidos borró % (esperado 3)', n; end if;
  delete from public.lots where id in (select id from w1_manifest where tbl = 'lots');
  get diagnostics n = row_count; if n <> 3 then raise exception 'W1_BASE_LIMPIA_ABORT: lotes borró % (esperado 3)', n; end if;
end
$purge$;
set local renovacell.purge = 'off';

-- Constancia en la bitácora (append-only).
insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
select null, 'W1 base limpia: purga de datos de prueba (D-01)', 'app', 'w1_base_limpia',
       jsonb_build_object('manifest', (select jsonb_agg(jsonb_build_object('tbl', tbl, 'id', id, 'descr', descr)) from w1_manifest),
                          'archive_schema', 'w1_archive', 'executed_at', now(), 'executed_by', current_user);

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN FINAL (cualquier falla ⇒ ROLLBACK de todo)
-- ---------------------------------------------------------------------------
do $verify$
declare r record; now_n bigint;
begin
  if (select count(*) from public.orders) <> 0 or (select count(*) from public.order_items) <> 0
     or (select count(*) from public.lots) <> 0 or (select count(*) from public.inventory_movements) <> 0 then
    raise exception 'W1_BASE_LIMPIA_ABORT: quedaron filas operativas tras la purga';
  end if;
  if (select count(*) from w1_archive.orders) <> 3 or (select count(*) from w1_archive.order_items) <> 2
     or (select count(*) from w1_archive.lots) <> 3 or (select count(*) from w1_archive.inventory_movements) <> 5 then
    raise exception 'W1_BASE_LIMPIA_ABORT: el archivo no contiene exactamente el manifiesto';
  end if;
  for r in select * from w1_masters loop
    execute case r.k
      when 'products' then 'select count(*) from public.products'
      when 'product_prices' then 'select count(*) from public.product_prices'
      when 'product_volume_prices' then 'select count(*) from public.product_volume_prices'
      when 'product_costs' then 'select count(*) from public.product_costs'
      when 'price_lists' then 'select count(*) from public.price_lists'
      when 'profiles' then 'select count(*) from public.profiles'
      when 'profiles_doctor' then 'select count(*) from public.profiles where role_id = ''doctor'''
      when 'auth_users' then 'select count(*) from auth.users'
      when 'customers' then 'select count(*) from public.customers'
      when 'doctor_locations' then 'select count(*) from public.doctor_locations'
      when 'prospects' then 'select count(*) from public.prospects'
      when 'notifications' then 'select count(*) from public.notifications'
      when 'storage_objects' then 'select count(*) from storage.objects'
      when 'company_settings' then 'select count(*) from public.company_settings'
      when 'company_bank_accounts' then 'select count(*) from public.company_bank_accounts'
      when 'audit_logs' then 'select count(*) - 1 from public.audit_logs'   -- +1 = la constancia de arriba
    end into now_n;
    if now_n <> r.n then
      raise exception 'W1_BASE_LIMPIA_ABORT: dato maestro % cambió (% → %)', r.k, r.n, now_n;
    end if;
  end loop;
  raise notice 'W1_BASE_LIMPIA_OK: 13 filas de prueba archivadas y purgadas; datos maestros idénticos.';
end
$verify$;

commit;
