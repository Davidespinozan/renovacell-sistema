-- ============================================================================
-- W2-C · C6 — LIMPIEZA DE LA CUSTODIA LEGACY.
--
-- Va DESPUÉS de C1–C4 a propósito: primero se activa y se verifica la arquitectura
-- nueva, y solo entonces se destruye la vieja. Esa separación es la frontera de
-- rollback que el dueño pidió conservar.
--
-- Elimina lo que W2-C dejó inerte en C4:
--   · event_sell           — mutaba events.items->sold sin op_id, sin bitácora,
--                            sin inventario y sin dinero;
--   · events               — inventario del stand en un contador jsonb que el
--                            propio miembro del evento podía reescribir;
--   · consignment_stock    — saldo por (vendedor, producto) que el propio vendedor
--                            podía reescribir.
-- Su reemplazo es custodies + custody_lines + custody_operations, donde todo saldo
-- se DERIVA de un libro append-only escrito solo por comandos del servidor.
--
-- IDEMPOTENTE: una segunda ejecución no falla ni borra nada. Si el legacy ya no
-- existe y la custodia nueva sigue en pie, es un no-op (already_applied).
--
-- ABORTA, sin borrar nada, si:
--   · falta una pieza obligatoria de la arquitectura nueva (no se destruye lo viejo
--     sin lo nuevo en su lugar);
--   · alguna tabla legacy TIENE FILAS (no se elimina historia: habría que
--     reconstruirla como libro de custodia primero);
--   · algo depende todavía de las tablas legacy y el cleanup no sería seguro.
--
-- Reversible con supabase/rollback/w2c/00_w2_snapshot.sql, que conserva el DDL
-- original de las dos tablas, sus políticas y event_sell.
-- ============================================================================

do $c6$
declare
  v_events boolean := to_regclass('public.events') is not null;
  v_consig boolean := to_regclass('public.consignment_stock') is not null;
  v_sell   boolean := to_regprocedure('public.event_sell(uuid,jsonb)') is not null;
  n int;
begin
  -- 1) La arquitectura nueva es obligatoria SIEMPRE, incluso en el no-op: si no está,
  --    algo se aplicó fuera de orden y no se toca nada.
  if to_regclass('public.custodies') is null
     or to_regclass('public.custody_lines') is null
     or to_regclass('public.custody_operations') is null
     or to_regclass('public.v_stock_disponible') is null
     or to_regclass('public.v_custody_stock') is null
     or to_regclass('public.v_custody_liquidacion') is null then
    raise exception 'W2C_C6_PRECONDICION: falta la custodia nueva (custodies / custody_lines / custody_operations / vistas). Aplica C1–C3 antes del cleanup.';
  end if;

  -- 2) Ya aplicado: nada que limpiar. La AUSENCIA del legacy no es un error.
  if not v_events and not v_consig and not v_sell then
    raise notice 'W2C_C6: already_applied — el legacy ya no existe y la custodia nueva está intacta.';
    return;
  end if;

  -- 3) No se elimina HISTORIA. Solo se consulta lo que existe.
  if v_events then
    execute 'select count(*) from public.events' into n;
    if n > 0 then
      raise exception 'W2C_C6_PRECONDICION: events tiene % fila(s); no se elimina historia. Reconstrúyela como libro de custodia primero.', n;
    end if;
  end if;
  if v_consig then
    execute 'select count(*) from public.consignment_stock' into n;
    if n > 0 then
      raise exception 'W2C_C6_PRECONDICION: consignment_stock tiene % fila(s); no se elimina historia.', n;
    end if;
  end if;

  -- 4) Nadie puede depender todavía de las tablas legacy (vistas, reglas).
  select count(*) into n
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v on v.oid = r.ev_class
   where v.relkind = 'v'
     and ((v_events and d.refobjid = to_regclass('public.events'))
       or (v_consig and d.refobjid = to_regclass('public.consignment_stock')));
  if n > 0 then
    raise exception 'W2C_C6_PRECONDICION: % vista(s) dependen todavía de las tablas legacy; el cleanup no sería seguro.', n;
  end if;

  -- 5) Cleanup. Cada pieza solo si sigue existiendo (re-ejecución parcial segura).
  if v_sell   then execute 'drop function public.event_sell(uuid, jsonb)'; end if;
  if v_consig then execute 'drop table public.consignment_stock'; end if;
  if v_events then execute 'drop table public.events'; end if;

  raise notice 'W2C_C6: applied — legacy eliminado (event_sell: %, consignment_stock: %, events: %).',
    v_sell, v_consig, v_events;
end
$c6$;
