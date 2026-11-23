-- 0764 down: upsert_customer_contact vuelve a aceptar correo y teléfono sin validar.
CREATE OR REPLACE FUNCTION public.upsert_customer_contact(p_customer_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- C360-F3 · Autoridad acotada: Dirección todo (incl. seller_name, solo referencia histórica); vendedor SOLO su
-- cartera y sin nombre ni seller_name; doctor lo suyo; facturación ya NO edita contacto. El teléfono se refleja
-- en customer_phones (trigger). Cada cambio queda en customer_events (solo nombres de campo).
declare a text; v_meta jsonb; v_campos text[] := '{}'; k text;
begin
  if p_customer_id is null then raise exception 'CLIENTE_REQUERIDO'; end if;
  select meta into v_meta from public.customers where id = p_customer_id for update;
  if not found then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_actor(p_customer_id);
  if a is null or a = 'facturacion' then raise exception 'NO_AUTORIZADO'; end if;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if nullif(btrim(coalesce(p_patch ->> k, '')), '') is null then continue; end if;
    if k = 'seller_name' and a not in ('direccion', 'servicio') then continue; end if;
    if k = 'full_name' and a = 'vendedor' then continue; end if;
    if k = 'notes' and a = 'dueno' then continue; end if;
    if k in ('full_name', 'email', 'phone', 'city', 'seller_name', 'organization', 'notes') then v_campos := v_campos || k; end if;
  end loop;
  update public.customers set
    full_name  = case when 'full_name' = any (v_campos) then btrim(p_patch->>'full_name') else full_name end,
    email      = case when 'email' = any (v_campos) then btrim(p_patch->>'email') else email end,
    phone      = case when 'phone' = any (v_campos) then btrim(p_patch->>'phone') else phone end,
    city       = case when 'city' = any (v_campos) then btrim(p_patch->>'city') else city end,
    seller_name = case when 'seller_name' = any (v_campos) then btrim(p_patch->>'seller_name') else seller_name end,
    meta = coalesce(meta,'{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'organization', case when 'organization' = any (v_campos) then btrim(p_patch->>'organization') else meta->>'organization' end,
                'notes',        case when 'notes' = any (v_campos) then btrim(p_patch->>'notes') else meta->>'notes' end)),
    updated_at = now()
  where id = p_customer_id;
  if array_length(v_campos, 1) > 0 then perform public._c360_evento(p_customer_id, 'contacto_actualizado', jsonb_build_object('campos', to_jsonb(v_campos), 'via', 'upsert_customer_contact'), a); end if;
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end;
$function$

;
