-- Fix: en event_sell la variable `items` chocaba con la columna events.items en el
-- UPDATE final (42702 "column reference is ambiguous") → la venta nunca se aplicaba.
-- Se renombra la variable a v_items y se cualifica el UPDATE.
CREATE OR REPLACE FUNCTION public.event_sell(p_event uuid, p_sales jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_items jsonb; sale jsonb; i int; it jsonb; assigned int; sold int; qty int; pid text; found boolean;
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','pos'])) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT e.items INTO v_items FROM public.events e WHERE e.id = p_event FOR UPDATE;
  IF v_items IS NULL THEN RETURN false; END IF;
  -- Verifica TODO primero (todo-o-nada).
  FOR sale IN SELECT * FROM jsonb_array_elements(p_sales) LOOP
    pid := sale ->> 'product_id'; qty := (sale ->> 'qty')::int; found := false;
    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      it := v_items -> i;
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
    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      it := v_items -> i;
      IF (it ->> 'product_id') = pid THEN
        sold := COALESCE((it ->> 'sold')::int, 0);
        v_items := jsonb_set(v_items, ARRAY[i::text, 'sold'], to_jsonb(sold + qty));
      END IF;
    END LOOP;
  END LOOP;
  UPDATE public.events SET items = v_items WHERE id = p_event;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.event_sell(uuid, jsonb) TO authenticated;
