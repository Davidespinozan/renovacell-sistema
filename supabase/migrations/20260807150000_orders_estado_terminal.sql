-- MÁQUINA DE ESTADOS DEL PEDIDO: los estados TERMINALES son finales (defensa en la BASE).
--
-- Hoy los estados del pedido se cambian con UPDATE directo desde el cliente (packed→
-- shipped→delivered, cancelar). RLS deja tocar la fila pero NO valida la transición: un
-- código con bug —o un UPDATE manual— podría "revivir" un pedido cancelado o revertir uno
-- entregado, re-descontando inventario o re-cobrando. Sala aprendió que la regla debe vivir
-- en la BASE, no en el front (que se salta con supabase-js).
--
-- Invariante que se blinda (el de mayor valor y CERO riesgo de regresión, porque ningún
-- flujo legítimo lo hace): un pedido `cancelled` / `delivered` / `fulfilled` NO cambia de
-- estado. Todas las transiciones HACIA ADELANTE siguen libres. POS nace en `delivered` por
-- INSERT (no dispara este trigger, que es solo ON UPDATE OF status).
--
-- Escape controlado (purga/corrección administrativa): SET LOCAL renovacell.purge = 'on'.

CREATE OR REPLACE FUNCTION public.orders_estado_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('renovacell.purge', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('cancelled', 'fulfilled')
       OR (OLD.status = 'delivered' AND NEW.status NOT IN ('delivered', 'fulfilled')) THEN
      RAISE EXCEPTION 'ESTADO_TERMINAL: un pedido % no puede cambiar de estado (intento % → %).', OLD.status, OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_orders_estado_terminal ON public.orders;
CREATE TRIGGER trg_orders_estado_terminal
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_estado_terminal();

-- Test de contrato: aborta el deploy si el guard no quedó instalado.
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_orders_estado_terminal'),
    'FALTA el trigger de estado terminal en orders';
  RAISE NOTICE 'Máquina de estados OK: trigger de estado terminal instalado.';
END $$;
