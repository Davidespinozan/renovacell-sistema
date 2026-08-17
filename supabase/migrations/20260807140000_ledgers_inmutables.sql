-- BLINDAJE APPEND-ONLY de la bitácora y el kardex (integridad regulatoria).
--
-- `audit_logs` (quién hizo qué) e `inventory_movements` (entradas/salidas por lote) eran
-- "idealmente append-only" pero SIN trigger que lo impidiera: se podían EDITAR o BORRAR.
-- En un sistema médico (COFEPRIS / LFPDPPP) un registro de auditoría o un movimiento de
-- inventario que se puede reescribir NO es evidencia confiable ante un recall o una
-- inspección. Aquí se vuelven inmutables: corregir = asentar un registro NUEVO (como ya
-- lo hace `refunds`). Verificado: nada en el código edita/borra estas tablas, y
-- `inventory_movements.lot_id` referencia `lots` SIN cascade → blindarlas no rompe nada.
--
-- Escape controlado para purga administrativa (borrar un set de pruebas): el service_role
-- puede `SET LOCAL renovacell.purge = 'on'` en su transacción. Un usuario normal, nunca.

CREATE OR REPLACE FUNCTION public.ledger_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('renovacell.purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);  -- purga administrativa deliberada
  END IF;
  RAISE EXCEPTION 'LEDGER_APPEND_ONLY: % es inmutable (auditoría/kardex). Para corregir, registra un asiento nuevo, no edites el histórico.', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END; $$;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

DROP TRIGGER IF EXISTS trg_inventory_movements_append_only ON public.inventory_movements;
CREATE TRIGGER trg_inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

-- Test de contrato: aborta el deploy si algún guard no quedó instalado.
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_append_only'),
    'FALTA el trigger append-only de audit_logs';
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventory_movements_append_only'),
    'FALTA el trigger append-only de inventory_movements';
  RAISE NOTICE 'Blindaje append-only OK: audit_logs + inventory_movements ahora son inmutables.';
END $$;
