-- Endurecimiento tras auditoría end-to-end (integridad + seguridad).

-- 1) apply_lot_movement: NO enmascarar sobreventa. Antes: GREATEST(0, ...) topaba
--    la cantidad a 0 pero el ledger registraba el cambio COMPLETO → sobreventa
--    silenciosa + reingreso fantasma en cancelaciones. Ahora una SALIDA que dejaría
--    negativo FALLA (RAISE), y el movimiento siempre refleja lo realmente aplicado.
CREATE OR REPLACE FUNCTION public.apply_lot_movement(p_lot uuid, p_change int, p_reason text, p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','warehouse','packing','pos'])) THEN
    RAISE EXCEPTION 'No autorizado para mover inventario';
  END IF;
  IF p_change < 0 THEN
    -- Salida: descuenta solo si hay existencia suficiente (evita sobreventa).
    UPDATE public.lots SET quantity = quantity + p_change
      WHERE id = p_lot AND quantity + p_change >= 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventario insuficiente en el lote % (se evitó sobreventa)', p_lot;
    END IF;
  ELSE
    UPDATE public.lots SET quantity = quantity + p_change WHERE id = p_lot;
  END IF;
  INSERT INTO public.inventory_movements(lot_id, change, reason, reference, created_by)
  VALUES (p_lot, p_change, p_reason, p_reference, auth.uid());
END; $$;

-- 2) notifications: cerrar el INSERT a NO-doctores (antes WITH CHECK true dejaba a
--    un doctor insertar avisos internos = vector de spam/ingeniería social).
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() <> 'doctor');

-- 3) staff_directory: el nombre NO debe caer al correo (fuga de PII staff→staff).
--    Fallback a un placeholder si no hay meta.name ni full_name.
CREATE OR REPLACE VIEW public.staff_directory AS
SELECT
  p.id,
  COALESCE(NULLIF(p.meta ->> 'name', ''), NULLIF(p.full_name, ''), 'Usuario') AS name,
  p.meta ->> 'avatar_url' AS avatar_url,
  p.role_id
FROM public.profiles p
WHERE p.role_id <> 'doctor'
  AND public.auth_role() <> 'doctor';
GRANT SELECT ON public.staff_directory TO authenticated;
