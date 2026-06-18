-- Audit triggers: append to audit_logs on state changes for orders and shipments
-- Requires audit_logs table as defined in schema.sql

-- Function to insert audit log
CREATE OR REPLACE FUNCTION public.log_audit() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_logs(actor, action, resource_type, resource_id, payload, created_at)
  VALUES (current_setting('request.jwt.claims.sub', true)::uuid,
          TG_OP || ' ' || TG_TABLE_NAME,
          TG_TABLE_NAME,
          NEW.id::text,
          row_to_json(NEW)::jsonb,
          now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
