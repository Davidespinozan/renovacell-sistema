-- Audit triggers: append to audit_logs on state changes for orders and shipments
-- Requires audit_logs table as defined in schema.sql

-- Function to insert audit log.
-- actor = auth.uid() (lo resuelve Supabase desde el JWT). Si la operación corre
-- con service_role o sin sesión, auth.uid() es NULL y queda registrado como tal.
CREATE OR REPLACE FUNCTION public.log_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_logs(actor, action, resource_type, resource_id, payload, created_at)
  VALUES (auth.uid(),
          TG_OP || ' ' || TG_TABLE_NAME,
          TG_TABLE_NAME,
          NEW.id::text,
          row_to_json(NEW)::jsonb,
          now());
  RETURN NEW;
END;
$$;

-- Orders: log INSERT and UPDATE
DROP TRIGGER IF EXISTS orders_audit_trigger ON orders;
CREATE TRIGGER orders_audit_trigger
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE PROCEDURE public.log_audit();

-- Shipments: log INSERT and UPDATE
DROP TRIGGER IF EXISTS shipments_audit_trigger ON shipments;
CREATE TRIGGER shipments_audit_trigger
AFTER INSERT OR UPDATE ON shipments
FOR EACH ROW EXECUTE PROCEDURE public.log_audit();

-- Note: the function reads JWT claim `sub` via current_setting; ensure Postgres setting is available when using supabase-auth. Alternatively, set actor explicitly in server-side operations.
