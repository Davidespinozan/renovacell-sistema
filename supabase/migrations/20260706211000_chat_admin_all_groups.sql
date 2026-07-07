-- Ajuste: Dirección (admin) supervisa toda la operación → ve TODOS los grupos,
-- no solo el suyo. El resto del staff sigue viendo 'Todos' + el grupo de su área.
-- Los DMs siguen siendo privados a sus miembros; los doctores, excluidos.
CREATE OR REPLACE FUNCTION public.can_access_conversation(cid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT public.auth_role() <> 'doctor' AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = cid AND (
      (c.kind = 'dm' AND auth.uid() = ANY (c.member_ids))
      OR (c.kind = 'group' AND (
        public.auth_role() = 'admin'                                  -- Dirección ve todos los grupos
        OR c.area IS NULL                                             -- 'Todos'
        OR public.auth_role() = c.area                                -- grupo de tu área
        OR (c.area = 'warehouse' AND public.auth_role() = 'packing')  -- empaque ⊂ almacén
        OR (c.area = 'admin' AND public.auth_role() = ANY (ARRAY['billing','comm']))
      ))
    )
  );
$$;
