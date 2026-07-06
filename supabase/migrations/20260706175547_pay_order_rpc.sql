-- El orders_guard ahora honra un contexto "confiable" (funciones SECURITY DEFINER
-- que ya validaron la regla) y a la service_role. El resto de reglas por rol
-- queda igual.
CREATE OR REPLACE FUNCTION public.orders_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r text := public.auth_role();
BEGIN
  IF coalesce(current_setting('app.trusted', true), '') = 'on'
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' THEN
    RETURN NEW;
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
END; $$;

-- Registrar el pago de un pedido (lo que en producción dispara el webhook de
-- Stripe). Valida que el llamante sea el dueño o staff de cobro, luego marca
-- pagado y avanza a 'paid'. Corre en contexto confiable (bypass del guard).
CREATE OR REPLACE FUNCTION public.pay_order(p_order uuid, p_method text, p_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no existe'; END IF;
  IF NOT (o.doctor_id = auth.uid() OR public.auth_role() = ANY (ARRAY['admin','billing','pos','warehouse','packing'])) THEN
    RAISE EXCEPTION 'No autorizado para cobrar este pedido';
  END IF;
  PERFORM set_config('app.trusted','on', true);
  UPDATE public.orders
     SET payment_status='paid', payment_method=p_method, payment_ref=p_ref,
         status = CASE WHEN status='pending_payment' THEN 'paid' ELSE status END
   WHERE id = p_order;
END; $$;
REVOKE ALL ON FUNCTION public.pay_order(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_order(uuid, text, text) TO authenticated;
