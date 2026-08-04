-- DEVOLUCIONES / CORRECCIONES sobre pedidos (append-only).
--
-- Renovacell registra el dinero en `orders` (total/payment_status). Cuando hay que
-- devolver a un cliente o corregir un cobro mal hecho, NO se edita ni borra el pedido
-- original (eso descuadra la contabilidad para siempre): se agrega un registro de
-- devolución que APUNTA al pedido. Los reportes restan estas devoluciones del neto.
--
-- Dos tipos, misma mecánica, distinta semántica para auditoría:
--   · 'devolucion'  → se le regresó dinero al cliente (producto devuelto, etc.)
--   · 'correccion'  → el cobro estuvo mal (duplicado, no pagó, error de captura)
--
-- Escritura SOLO por la RPC `registrar_devolucion` (SECURITY DEFINER, valida rol,
-- tope y motivo). La tabla es append-only: un trigger bloquea UPDATE/DELETE. Corregir
-- una devolución = registrar otra, nunca tocar la anterior.

CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  tipo text NOT NULL CHECK (tipo IN ('devolucion', 'correccion')),
  monto numeric NOT NULL CHECK (monto > 0),
  motivo text NOT NULL,
  metodo text,              -- método del pedido (efectivo/tarjeta) para el arqueo de caja
  usuario text,             -- nombre de quien la registró (auditoría legible)
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON public.refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_created ON public.refunds(created_at DESC);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- Solo lectura para caja/finanzas/dirección. Sin políticas de INSERT/UPDATE/DELETE:
-- la única vía de escritura es la RPC de abajo.
DROP POLICY IF EXISTS refunds_select ON public.refunds;
CREATE POLICY refunds_select ON public.refunds FOR SELECT TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','billing','pos']));

-- Append-only: nunca se edita ni se borra una devolución (así el histórico es fiable).
CREATE OR REPLACE FUNCTION public.refunds_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las devoluciones son inmutables: registra una nueva en vez de editar o borrar (%).', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS trg_refunds_append_only ON public.refunds;
CREATE TRIGGER trg_refunds_append_only
  BEFORE UPDATE OR DELETE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.refunds_append_only();

-- RPC: registra una devolución/corrección con validación de rol, motivo y TOPE
-- (no se puede devolver más de lo que resta del pedido). Recalcula el tope del lado
-- servidor: nunca confía en el número del cliente.
CREATE OR REPLACE FUNCTION public.registrar_devolucion(
  p_order_id uuid,
  p_tipo     text,
  p_monto    numeric,
  p_motivo   text,
  p_usuario  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total     numeric;
  v_status    text;
  v_metodo    text;
  v_devuelto  numeric;
  v_restante  numeric;
  v_id        uuid;
BEGIN
  IF public.auth_role() <> ANY (ARRAY['admin','billing','pos']) THEN
    RAISE EXCEPTION 'NO_AUTORIZADO: no tienes permiso para registrar devoluciones';
  END IF;
  IF p_tipo IS NULL OR p_tipo <> ALL (ARRAY['devolucion','correccion']) THEN
    RAISE EXCEPTION 'TIPO_INVALIDO: usa devolucion o correccion';
  END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: sin motivo no se puede auditar la devolución';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: el monto debe ser mayor a cero';
  END IF;

  SELECT o.total, o.status, o.payment_method
    INTO v_total, v_status, v_metodo
    FROM public.orders o WHERE o.id = p_order_id;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'PEDIDO_INVALIDO: el pedido no existe';
  END IF;
  IF v_status = 'draft' THEN
    RAISE EXCEPTION 'PEDIDO_INVALIDO: no se puede devolver un borrador';
  END IF;

  SELECT coalesce(sum(r.monto), 0) INTO v_devuelto
    FROM public.refunds r WHERE r.order_id = p_order_id;
  v_restante := v_total - v_devuelto;
  IF p_monto > v_restante THEN
    RAISE EXCEPTION 'MONTO_EXCEDE: el máximo por devolver de este pedido es %', v_restante;
  END IF;

  INSERT INTO public.refunds (order_id, tipo, monto, motivo, metodo, usuario, created_by)
  VALUES (p_order_id, p_tipo, p_monto,
          left(btrim(p_motivo), 400), v_metodo,
          coalesce(nullif(btrim(p_usuario), ''), 'Sistema'), auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'restante', v_restante - p_monto);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_devolucion(uuid, text, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion(uuid, text, numeric, text, text) TO authenticated;

-- Auto-pruebas de la migración (fallan ruidosamente si algo no quedó).
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE relname = 'refunds'), 'RLS no está activo en refunds';
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'registrar_devolucion'), 'falta la RPC registrar_devolucion';
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refunds_append_only'), 'falta el trigger append-only';
  ASSERT NOT has_function_privilege('anon', 'public.registrar_devolucion(uuid, text, numeric, text, text)', 'EXECUTE'), 'anon NO debe poder ejecutar la RPC';
  ASSERT has_function_privilege('authenticated', 'public.registrar_devolucion(uuid, text, numeric, text, text)', 'EXECUTE'), 'authenticated SÍ debe poder ejecutar la RPC';
END $$;