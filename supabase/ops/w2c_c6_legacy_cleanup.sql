-- ============================================================================
-- W2-C · C6 — LIMPIEZA DE LA CUSTODIA LEGACY.  ⚠ PREPARADO, NO APLICADO.
--
-- Vive FUERA de supabase/migrations a propósito: así `supabase db push` NO lo aplica.
-- Cuando el dueño lo autorice, se mueve a
--   supabase/migrations/2026<AAAAMMDD>120000_w2c_c6_legacy_cleanup.sql
-- y se aplica con el resto.
--
-- REQUISITOS previos (el bloque de abajo los verifica y ABORTA si falta uno):
--   1. C1–C5 aplicados y verificados;
--   2. el frontend nuevo publicado y con smoke autenticado en verde;
--   3. ningún consumidor del frontend lee events / consignment_stock;
--   4. event_sell ya revocado (C4);
--   5. ambas tablas VACÍAS.
--
-- Reversible con supabase/rollback/w2c/00_w2_snapshot.sql, que conserva el DDL
-- original de las dos tablas, sus políticas y event_sell. No hay pérdida de datos
-- porque la precondición exige 0 filas.
-- ============================================================================

do $pre$
declare n int;
begin
  select count(*) into n from public.events;
  if n > 0 then raise exception 'W2C_C6_PRECONDICION: events tiene % fila(s); no se elimina historia.', n; end if;
  select count(*) into n from public.consignment_stock;
  if n > 0 then raise exception 'W2C_C6_PRECONDICION: consignment_stock tiene % fila(s); no se elimina historia.', n; end if;

  -- La arquitectura nueva debe existir: no se borra lo viejo sin lo nuevo en su lugar.
  if to_regclass('public.custody_lines') is null or to_regclass('public.custodies') is null then
    raise exception 'W2C_C6_PRECONDICION: falta la custodia nueva (custodies/custody_lines). Aplica C1–C3 primero.';
  end if;

  -- Nadie puede depender de las tablas legacy (vistas, funciones, constraints).
  select count(*) into n
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v on v.oid = r.ev_class
   where d.refobjid in ('public.events'::regclass, 'public.consignment_stock'::regclass)
     and v.relkind = 'v';
  if n > 0 then raise exception 'W2C_C6_PRECONDICION: % vista(s) dependen de las tablas legacy.', n; end if;
end
$pre$;

drop function if exists public.event_sell(uuid, jsonb);
drop table if exists public.consignment_stock;
drop table if exists public.events;
