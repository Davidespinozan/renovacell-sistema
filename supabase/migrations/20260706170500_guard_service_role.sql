-- El guard de profiles debe honrar a la service_role (backend/seeds), tal como
-- el resto del RLS. Sin esto, sembrar usuarios con rol/verified se bloquea.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     OR public.auth_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'No autorizado: no puedes modificar role_id ni verified';
  END IF;
  RETURN NEW;
END;
$$;
