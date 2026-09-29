-- ============================================================================
-- W1 · M4 — CIERRE DE AUTORIDAD: el inventario solo cambia por comandos.
--
--  · lots / inventory_movements / order_items: sin escritura directa de clientes
--  · replenishments: clientes solo crean (estado inicial forzado) y marcan `paid`
--  · orders: `packed` y `cancelled` solo por comando; sin regresiones de estado
--  · shipping_attempts: solo se crea guía para un pedido empacado y no cancelado
--  · apply_lot_movement: revocado (lo reemplaza ajustar_lote)
--
-- Las definiciones previas quedan en supabase/rollback/w1/00_prod_snapshot.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) LOTES: solo lectura para clientes (SELECT lots_select_ops se conserva)
-- ---------------------------------------------------------------------------
drop policy if exists lots_write_warehouse on public.lots;
revoke insert, update, delete, truncate on public.lots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) KARDEX: sin inserción directa (SELECT invmov_select_ops se conserva)
-- ---------------------------------------------------------------------------
drop policy if exists invmov_insert_ops on public.inventory_movements;
revoke insert, update, delete, truncate on public.inventory_movements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) RENGLONES DE PEDIDO: los escriben crear_pedido / vender_pos / surtir_pedido
--    (verificado: el cliente con backend no escribe order_items directamente)
-- ---------------------------------------------------------------------------
drop policy if exists order_items_insert_scoped on public.order_items;
drop policy if exists order_items_update_scoped on public.order_items;
drop policy if exists order_items_delete_scoped on public.order_items;
revoke insert, update, delete, truncate on public.order_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) COMPRAS: crear (admin/billing, estado inicial forzado) y marcar `paid`.
--    Estado, acumulado y cierre: solo por comando.
-- ---------------------------------------------------------------------------
drop policy if exists replenishments_update on public.replenishments;
revoke update, delete, truncate on public.replenishments from anon, authenticated;
grant update (paid) on public.replenishments to authenticated;
create policy replenishments_update_paid on public.replenishments
  for update to authenticated
  using (public.auth_role() = any (array['admin','billing']))
  with check (public.auth_role() = any (array['admin','billing']));

create or replace function public.replenishments_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if coalesce(current_setting('app.trusted', true), '') = 'on'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pendiente'; new.received_qty := 0;
    new.closed_by := null; new.closed_at := null; new.close_reason := null;
    return new;
  end if;
  if (new.id, new.product_id, new.product_name, new.qty, new.unit_cost, new.kind, new.supplier, new.status,
      new.received_qty, new.closed_by, new.closed_at, new.close_reason, new.created_by, new.created_at)
     is distinct from
     (old.id, old.product_id, old.product_name, old.qty, old.unit_cost, old.kind, old.supplier, old.status,
      old.received_qty, old.closed_by, old.closed_at, old.close_reason, old.created_by, old.created_at) then
    raise exception 'REABASTECIMIENTO_SOLO_POR_COMANDO: estado, cantidades y cierre cambian solo por recepción/cierre';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_replenishments_guard on public.replenishments;
create trigger trg_replenishments_guard before insert or update on public.replenishments
  for each row execute function public.replenishments_guard();

-- ---------------------------------------------------------------------------
-- 5) PEDIDOS: guarda de transiciones relevantes para inventario (antes del
--    atajo de admin; el resto de la guarda previa queda IDÉNTICO).
-- ---------------------------------------------------------------------------
create or replace function public.orders_guard() returns trigger
  language plpgsql security definer set search_path = public as
$function$
DECLARE r text := public.auth_role();
BEGIN
  IF coalesce(current_setting('app.trusted', true), '') = 'on'
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- W1: transiciones de inventario solo por comando; sin regresar desde empacado o posterior.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('packed','cancelled') THEN
      RAISE EXCEPTION 'TRANSICION_SOLO_POR_COMANDO: % → % solo por comando del servidor (surtir_pedido / cancelar_pedido)', OLD.status, NEW.status;
    END IF;
    IF OLD.status IN ('packed','shipped','delivered','fulfilled')
       AND NEW.status IN ('draft','pending_payment','paid','picking') THEN
      RAISE EXCEPTION 'TRANSICION_REGRESIVA: % → % no permitido', OLD.status, NEW.status;
    END IF;
    IF (NEW.status = 'picking'   AND OLD.status IS DISTINCT FROM 'paid')
       OR (NEW.status = 'shipped'   AND OLD.status IS DISTINCT FROM 'packed')
       OR (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'shipped')
       OR (NEW.status = 'fulfilled' AND OLD.status IS DISTINCT FROM 'delivered') THEN
      RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF r = 'admin' THEN RETURN NEW; END IF;

  IF r = 'doctor' AND OLD.doctor_id = auth.uid() THEN
    IF OLD.status IS NOT NULL AND OLD.status NOT IN ('draft','pending_payment') THEN
      RAISE EXCEPTION 'No autorizado: el pedido ya está en proceso';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('draft','pending_payment','cancelled') THEN
      RAISE EXCEPTION 'No autorizado: el doctor no puede mover el pedido a ese estado';
    END IF;
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: no puedes modificar campos financieros del pedido';
    END IF;
    RETURN NEW;
  END IF;

  IF r IN ('warehouse','packing') THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id
       OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: almacén/empaque solo actualiza estado y envío';
    END IF;
    RETURN NEW;
  END IF;

  IF r = 'billing' THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'No autorizado: facturación no modifica doctor ni total';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END; $function$;

revoke truncate on public.orders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) GUÍAS: solo se crea un intento de guía para un pedido EMPACADO y no cancelado.
--    Traza del flujo actual (solo lectura): el único INSERT es la edge `shipping`
--    (create_shipment, service_role), invocada solo desde Empaque › Cola, cuya cola
--    lista únicamente pedidos 'packed'; chofer propio no usa esta tabla. La edge
--    trata el fallo del INSERT como 409 ANTES de llamar a DHL → sin cambios en la
--    edge. Lee el pedido con FOR SHARE para serializarse contra cancelar_pedido.
-- ---------------------------------------------------------------------------
create or replace function public.shipping_attempts_guard() returns trigger
  language plpgsql set search_path = public as
$$
declare v_status text;
begin
  select status into v_status from public.orders where id = new.order_id for share;
  if v_status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = new.order_id) then
    raise exception 'PEDIDO_CANCELADO: no se crea guía para un pedido cancelado' using errcode = 'check_violation';
  end if;
  if v_status is distinct from 'packed' then
    raise exception 'PEDIDO_NO_EMPACADO: solo se crea guía para un pedido empacado (está %)', coalesce(v_status, 'inexistente')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shipping_attempts_guard on public.shipping_attempts;
create trigger trg_shipping_attempts_guard before insert on public.shipping_attempts
  for each row execute function public.shipping_attempts_guard();

-- ---------------------------------------------------------------------------
-- 7) apply_lot_movement: fuera del alcance de clientes (merma/ajuste → ajustar_lote;
--    eventos/consignación quedan deshabilitados hasta W2 — ya eran code blocker)
-- ---------------------------------------------------------------------------
revoke all on function public.apply_lot_movement(uuid, integer, text, text) from public, anon, authenticated;

-- Funciones internas de guarda: no ejecutables por clientes.
revoke all on function public.replenishments_guard(), public.shipping_attempts_guard(),
  public.stock_return_lines_guard() from public, anon, authenticated;
