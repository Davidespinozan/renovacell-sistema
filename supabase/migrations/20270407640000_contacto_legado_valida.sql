-- AUDITORÍA DE ALTAS (23 nov 2026) · upsert_customer_contact (legado; hoy «Mi perfil» solo sincroniza el nombre) aceptaba
-- correo y teléfono sin validar. Ahora valida igual que la ficha (cliente_contacto_guardar / cliente_telefono_guardar):
-- correo con formato y en minúsculas; teléfono de 10 a 15 dígitos.
do $m$
declare v text := pg_get_functiondef('public.upsert_customer_contact'::regproc);
begin
  if position($q$  update public.customers set
    full_name  = case when 'full_name' = any (v_campos)$q$ in v) = 0
     or position($q$email      = case when 'email' = any (v_campos) then btrim(p_patch->>'email') else email end,$q$ in v) = 0 then
    raise exception 'CONTACTO-LEGADO: upsert_customer_contact no es la esperada'; end if;
  v := replace(v, $q$  update public.customers set
    full_name  = case when 'full_name' = any (v_campos)$q$, $q$  if 'email' = any (v_campos) and btrim(p_patch->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'CORREO_INVALIDO' using errcode = 'check_violation'; end if;
  if 'phone' = any (v_campos) and not public._c360_tel_valido(p_patch->>'phone') then
    raise exception 'TELEFONO_INVALIDO' using errcode = 'check_violation'; end if;
  update public.customers set
    full_name  = case when 'full_name' = any (v_campos)$q$);
  v := replace(v, $q$email      = case when 'email' = any (v_campos) then btrim(p_patch->>'email') else email end,$q$,
                  $q$email      = case when 'email' = any (v_campos) then lower(btrim(p_patch->>'email')) else email end,$q$);
  execute v;
end $m$;
