-- VENDEDOR-NOMBRE (0754) · down: el nombre vuelve a ser solo de Dirección (cliente_contacto_guardar como antes, sin copiar a la cuenta).
CREATE OR REPLACE FUNCTION public.cliente_contacto_guardar(p_customer uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c uuid := public._c360_cliente(p_customer); a text; v_campos text[] := '{}'; k text; v text;
  permitidos text[];
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor', 'dueno']);
  permitidos := case a when 'direccion' then array['full_name', 'email', 'city', 'country'] when 'servicio' then array['full_name', 'email', 'city', 'country']
                       when 'vendedor' then array['email', 'city', 'country'] else array['city', 'country'] end;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'CONTACTO_INVALIDO' using errcode = 'check_violation'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (permitidos)) then raise exception 'CAMPO_NO_PERMITIDO: %', k using errcode = 'insufficient_privilege'; end if;
    v := nullif(btrim(coalesce(p_patch ->> k, '')), '');
    if v is not null and length(v) > 160 then raise exception 'CONTACTO_INVALIDO: % demasiado largo', k using errcode = 'check_violation'; end if;
    if k = 'email' and v is not null and v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'CORREO_INVALIDO' using errcode = 'check_violation'; end if;
    if k = 'full_name' and v is null then raise exception 'NOMBRE_REQUERIDO' using errcode = 'check_violation'; end if;
    v_campos := v_campos || k;
  end loop;
  update public.customers set
    full_name = case when 'full_name' = any (v_campos) then btrim(p_patch ->> 'full_name') else full_name end,
    email     = case when 'email' = any (v_campos) then nullif(lower(btrim(p_patch ->> 'email')), '') else email end,
    city      = case when 'city' = any (v_campos) then nullif(btrim(p_patch ->> 'city'), '') else city end,
    country   = case when 'country' = any (v_campos) then nullif(btrim(p_patch ->> 'country'), '') else country end,
    updated_at = now()
  where id = v_c;
  perform public._c360_evento(v_c, 'contacto_actualizado', jsonb_build_object('campos', to_jsonb(v_campos)), a);
  return jsonb_build_object('customer_id', v_c, 'campos', to_jsonb(v_campos));
end;
$function$;

do $m$
declare v text := pg_get_functiondef('public.cliente_360'::regproc);
  nuevo text := $$when 'vendedor' then case when public._cc_vendedor_de_cliente(v_c) = auth.uid() then '["full_name","email","city","country"]'::jsonb else '["email","city","country"]'::jsonb end when 'dueno'$$;
  viejo text := $$when 'vendedor' then '["email","city","country"]'::jsonb when 'dueno'$$;
begin
  if position(nuevo in v) > 0 then execute replace(v, nuevo, viejo); end if;
end $m$;
