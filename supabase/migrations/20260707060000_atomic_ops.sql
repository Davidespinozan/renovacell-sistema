-- RPCs atómicas para cerrar dos condiciones de carrera de la auditoría.

-- #1 VENTA EN EVENTO atómica: incrementa `sold` de cada producto en el JSON de items
--    del evento con SELECT ... FOR UPDATE (serializa a los vendedores concurrentes),
--    y solo si TODO cabe (sold+qty <= assigned). Devuelve false si no alcanza. Evita
--    el lost-update / sobreventa cuando varios miembros venden a la vez en la expo.
CREATE OR REPLACE FUNCTION public.event_sell(p_event uuid, p_sales jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE items jsonb; sale jsonb; i int; it jsonb; assigned int; sold int; qty int; pid text; found boolean;
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','pos'])) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT e.items INTO items FROM public.events e WHERE e.id = p_event FOR UPDATE;
  IF items IS NULL THEN RETURN false; END IF;
  -- Verifica TODO primero (todo-o-nada).
  FOR sale IN SELECT * FROM jsonb_array_elements(p_sales) LOOP
    pid := sale ->> 'product_id'; qty := (sale ->> 'qty')::int; found := false;
    FOR i IN 0 .. jsonb_array_length(items) - 1 LOOP
      it := items -> i;
      IF (it ->> 'product_id') = pid THEN
        assigned := COALESCE((it ->> 'assigned')::int, 0); sold := COALESCE((it ->> 'sold')::int, 0);
        IF sold + qty > assigned THEN RETURN false; END IF;
        found := true;
      END IF;
    END LOOP;
    IF NOT found THEN RETURN false; END IF;
  END LOOP;
  -- Aplica.
  FOR sale IN SELECT * FROM jsonb_array_elements(p_sales) LOOP
    pid := sale ->> 'product_id'; qty := (sale ->> 'qty')::int;
    FOR i IN 0 .. jsonb_array_length(items) - 1 LOOP
      it := items -> i;
      IF (it ->> 'product_id') = pid THEN
        sold := COALESCE((it ->> 'sold')::int, 0);
        items := jsonb_set(items, ARRAY[i::text, 'sold'], to_jsonb(sold + qty));
      END IF;
    END LOOP;
  END LOOP;
  UPDATE public.events SET items = items WHERE id = p_event;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.event_sell(uuid, jsonb) TO authenticated;

-- #3 SURTIDO atómico: descuenta los lotes (con chequeo de sobreventa), registra los
--    movimientos, marca el pedido 'packed' y asigna el lote por renglón — TODO en una
--    sola transacción. Antes eran escrituras separadas (consume + markPacked): si una
--    fallaba a media, quedaba inventario descontado sin pedido empacado (o al revés).
CREATE OR REPLACE FUNCTION public.surtir_pedido(p_order uuid, p_ref text, p_allocations jsonb, p_item_lots jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb; lot uuid; qty int; k text; v text;
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  -- Solo un pedido pagado y aún no empacado (idempotencia / no saltar pasos).
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order AND status IN ('paid','picking')) THEN RETURN false; END IF;
  -- Descuenta cada lote (falla si dejaría negativo) + registra el movimiento.
  FOR a IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    lot := (a ->> 'lot_id')::uuid; qty := (a ->> 'qty')::int;
    UPDATE public.lots SET quantity = quantity - qty WHERE id = lot AND quantity - qty >= 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inventario insuficiente en el lote %', lot; END IF;
    INSERT INTO public.inventory_movements(lot_id, change, reason, reference, created_by)
    VALUES (lot, -qty, 'surtido', p_ref, auth.uid());
  END LOOP;
  -- Marca empacado y asigna el lote por renglón.
  UPDATE public.orders SET status = 'packed' WHERE id = p_order;
  FOR k, v IN SELECT * FROM jsonb_each_text(p_item_lots) LOOP
    UPDATE public.order_items SET lot_id = NULLIF(v, '')::uuid WHERE id = k::uuid;
  END LOOP;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.surtir_pedido(uuid, text, jsonb, jsonb) TO authenticated;
