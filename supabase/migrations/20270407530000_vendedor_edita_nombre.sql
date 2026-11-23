-- VENDEDOR-NOMBRE (23 nov 2026, DUEÑO): la vendedora corrige el NOMBRE de los clientes de SU cartera.
-- Antes (C360-F3, prueba 37) el nombre era solo de Dirección. Ahora:
--   · 'full_name' se permite al vendedor SOLO si es la vendedora asignada (_cc_vendedor_de_cliente = ella); con un
--     cliente sin vendedora (VENTAS-PUNTOS: cualquiera lo atiende) el nombre sigue siendo de Dirección.
--   · si el cliente tiene cuenta del portal, el nombre se copia a profiles.full_name y meta.name: la cartera, el chat y
--     los pedidos muestran el de la cuenta; si no, lo corregiría y seguiría viendo el viejo. Aplica igual a Dirección.
--   · queda en la actividad del cliente (evento contacto_actualizado con los campos y el actor; sin valores personales).
create or replace function public.cliente_contacto_guardar(p_customer uuid, p_patch jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_c uuid := public._c360_cliente(p_customer); a text; v_campos text[] := '{}'; k text; v text;
  permitidos text[]; v_profile uuid;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor', 'dueno']);
  permitidos := case a when 'direccion' then array['full_name', 'email', 'city', 'country'] when 'servicio' then array['full_name', 'email', 'city', 'country']
                       when 'vendedor' then case when public._cc_vendedor_de_cliente(v_c) = auth.uid() then array['full_name', 'email', 'city', 'country'] else array['email', 'city', 'country'] end
                       else array['city', 'country'] end;
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
  where id = v_c
  returning profile_id into v_profile;
  if 'full_name' = any (v_campos) and v_profile is not null then
    update public.profiles set full_name = btrim(p_patch ->> 'full_name'),
           meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('name', btrim(p_patch ->> 'full_name'))
     where id = v_profile;
  end if;
  perform public._c360_evento(v_c, 'contacto_actualizado', jsonb_build_object('campos', to_jsonb(v_campos)), a);
  return jsonb_build_object('customer_id', v_c, 'campos', to_jsonb(v_campos));
end;
$function$;

-- La ficha le muestra a la vendedora asignada el campo de nombre como editable (misma regla que arriba).
do $m$
declare v text := pg_get_functiondef('public.cliente_360'::regproc);
  viejo text := $$when 'vendedor' then '["email","city","country"]'::jsonb when 'dueno'$$;
  nuevo text := $$when 'vendedor' then case when public._cc_vendedor_de_cliente(v_c) = auth.uid() then '["full_name","email","city","country"]'::jsonb else '["email","city","country"]'::jsonb end when 'dueno'$$;
begin
  if position(viejo in v) = 0 then raise exception 'VENDEDOR-NOMBRE: cliente_360 no tiene el permiso de contacto esperado'; end if;
  execute replace(v, viejo, nuevo);
end $m$;
