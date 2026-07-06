-- La bitácora es inmutable: los clientes NO insertan directo. Esta función
-- SECURITY DEFINER registra la acción con el usuario en sesión como actor.
CREATE OR REPLACE FUNCTION public.log_audit(p_action text, p_resource text, p_detail text, p_actor_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs(actor, action, resource_type, resource_id, payload)
  VALUES (auth.uid(), p_action, 'app', p_resource, jsonb_build_object('actor_name', p_actor_name, 'detail', p_detail));
END; $$;
REVOKE ALL ON FUNCTION public.log_audit(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_audit(text, text, text, text) TO authenticated;
