-- IDENTIDAD DE CLIENTES (23 nov 2026, dueño: «dale» a los pendientes de la auditoría de altas).
-- Antes cada puerta buscaba duplicados con una llave distinta (alta de vendedora: teléfono; alta desde el chat: correo o
-- cédula; aprobación de cuentas: solo correo y, si no encontraba, creaba OTRA ficha), así que la misma doctora quedaba dos
-- veces. Y lo que el doctor captura al registrarse (cédula, celular, domicilio, especialidad) se quedaba en su cuenta.
--   1. _cliente_identidad: UNA búsqueda (teléfono —ficha y teléfonos de la ficha—, correo y cédula) que usan todas.
--   2. _cliente_adopta_registro: al aprobar una cuenta, su ficha recibe lo que falte (cédula, celular, domicilio,
--      especialidad). Nunca pisa lo que la ficha ya tiene y nunca frena la aprobación.
--   3. Alta de vendedora/Dirección: también encuentra por correo y por cualquier teléfono de la ficha; el nombre se guarda
--      como se escribió (antes en MAYÚSCULAS); el celular queda etiquetado «whatsapp»; la asignación deja historial.
--   4. Aprobación (vendedora o Dirección): liga la ficha existente por teléfono, correo o cédula antes de crear una nueva.
--      Dirección: la vendedora que elige en «Por verificar» ahora sí queda en la cartera (antes solo en seller_name).
--   5. Alta desde el chat: también detecta el duplicado por teléfono.

-- ── 1. Identidad ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._cliente_identidad(p_tel text, p_email text, p_cedula text, p_sin_cuenta boolean default false)
returns uuid language sql stable security definer set search_path to 'public' as $f$
  with k as (select public._c360_tel_norm(p_tel) as t, nullif(lower(btrim(coalesce(p_email, ''))), '') as e,
                    nullif(regexp_replace(coalesce(p_cedula, ''), '[^0-9]', '', 'g'), '') as ced),
  cand as (
    select c.id, c.created_at,
      (case when length(k.t) = 10 and (public._c360_tel_norm(c.phone) = k.t
              or exists (select 1 from public.customer_phones ph where ph.customer_id = c.id and ph.activo and ph.numero_norm = k.t)) then 1 else 0 end)
      + (case when k.e is not null and lower(btrim(c.email)) = k.e then 1 else 0 end)
      + (case when k.ced is not null and length(k.ced) >= 5 and regexp_replace(coalesce(c.meta ->> 'cedula', ''), '[^0-9]', '', 'g') = k.ced then 1 else 0 end) as puntos
    from public.customers c, k
    where c.active and (not coalesce(p_sin_cuenta, false) or c.profile_id is null))
  select id from cand where puntos > 0
   order by puntos desc, (public._cc_vendedor_de_cliente(id) is not null) desc, created_at
   limit 1
$f$;

-- Especialidad escrita libre («dermatóloga», «Medicina Estética») → clave del catálogo; si no, 'otra'.
create or replace function public._especialidad_de_texto(p text)
returns text language sql stable set search_path to 'public' as $f$
  with n as (select btrim(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z ]+', ' ', 'g')) as t)
  select case when (select t from n) = '' then null else coalesce(
    -- cada palabra de 5+ letras del nombre (sus primeras 5) debe aparecer: «médico general» → Medicina general, no estética
    (select e.clave from public.especialidades e, n where e.activa and e.clave <> 'otra'
        and not exists (select 1 from unnest(string_to_array(lower(translate(e.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), ' ')) w
                         where length(w) >= 5 and position(left(w, 5) in n.t) = 0)
      order by e.orden limit 1), 'otra') end
$f$;

-- Pone la especialidad solo si la ficha no tiene (nunca pisa lo que clasificó una persona).
create or replace function public._cliente_especialidad_si_falta(p_customer uuid, p_texto text)
returns boolean language plpgsql security definer set search_path to 'public' as $f$
declare v_clave text := public._especialidad_de_texto(p_texto); v_otra text := left(btrim(coalesce(p_texto, '')), 60);
begin
  if p_customer is null or v_clave is null or (v_clave = 'otra' and length(v_otra) < 2) then return false; end if;
  update public.customers set especialidad = v_clave, especialidad_otra = case when v_clave = 'otra' then v_otra end,
         tipo_cliente = coalesce(tipo_cliente, 'doctor'), perfil_actualizado_at = now(), updated_at = now()
   where id = p_customer and especialidad is null;
  return found;
end;
$f$;

-- ── 2. Lo del registro pasa a la ficha (al aprobar) ──────────────────────────────────────────────────────────────────
create or replace function public._cliente_adopta_registro(p_customer uuid, p_profile uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare m jsonb; v_ced text; v_tel text; v_n text; s jsonb; hecho text[] := '{}';
begin
  select coalesce(meta, '{}'::jsonb) into m from public.profiles where id = p_profile;
  if p_customer is null or m is null then return '{}'::jsonb; end if;
  -- cédula (solo dígitos, 5 a 8) si la ficha no tiene
  v_ced := regexp_replace(coalesce(m ->> 'cedula', ''), '[^0-9]', '', 'g');
  if v_ced ~ '^[0-9]{5,8}$' then
    update public.customers set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cedula', v_ced), updated_at = now()
     where id = p_customer and nullif(meta ->> 'cedula', '') is null;
    if found then hecho := array_append(hecho, 'cedula'); end if;
  end if;
  -- celular del registro (domicilio o importación) a los teléfonos de la ficha
  v_tel := coalesce(nullif(m -> 'shipping' ->> 'phone', ''), nullif(m ->> 'phone', ''));
  if v_tel is not null and public._c360_tel_valido(v_tel) then
    v_n := public._c360_tel_norm(v_tel);
    if not exists (select 1 from public.customer_phones where customer_id = p_customer and numero_norm = v_n and activo) then
      insert into public.customer_phones (customer_id, numero, numero_norm, etiqueta, es_principal, origen)
      values (p_customer, btrim(v_tel), v_n, 'celular', not exists (select 1 from public.customer_phones where customer_id = p_customer and es_principal and activo), 'legado');
      hecho := array_append(hecho, 'telefono');
    end if;
  end if;
  -- domicilio del registro como domicilio de entrega, si la ficha no tiene ninguno y está completo
  s := m -> 'shipping';
  if jsonb_typeof(s) = 'object' and nullif(btrim(coalesce(s ->> 'line1', '')), '') is not null and coalesce(s ->> 'cp', '') ~ '^[0-9]{5}$'
     and nullif(btrim(coalesce(s ->> 'city', '')), '') is not null and nullif(btrim(coalesce(s ->> 'state', '')), '') is not null
     and not exists (select 1 from public.doctor_locations l where l.active and (l.customer_id = p_customer or l.doctor_id = p_profile)) then
    begin
      perform public.cliente_ubicacion_guardar(p_customer, null, jsonb_build_object('tipo', 'OTRO', 'name', 'Domicilio del registro', 'line1', s ->> 'line1',
        'neighborhood', s ->> 'colonia', 'postal_code', s ->> 'cp', 'city', s ->> 'city', 'state', s ->> 'state', 'contact_phone', s ->> 'phone'), true);
      hecho := array_append(hecho, 'domicilio');
    exception when others then null;   -- sin permiso o incompleto: queda en «Domicilio del registro» para adoptarlo a mano
    end;
  end if;
  -- especialidad del registro
  if public._cliente_especialidad_si_falta(p_customer, coalesce(m ->> 'specialty', m ->> 'especialidad')) then hecho := array_append(hecho, 'especialidad'); end if;
  if array_length(hecho, 1) > 0 then
    perform public._c360_evento(p_customer, 'contacto_actualizado', jsonb_build_object('campos', to_jsonb(hecho), 'origen', 'registro'), 'servicio');
  end if;
  return jsonb_build_object('campos', to_jsonb(hecho));
exception when others then
  return jsonb_build_object('error', true);   -- nunca frena la aprobación
end;
$f$;

-- ── 3/4/5. Puertas ────────────────────────────────────────────────────────────────────────────────────────────────────
do $m$
declare v text;
begin
  -- 3. Alta de vendedora / Dirección
  v := pg_get_functiondef('public.cliente_prospecto_crear'::regproc);
  if position($$   limit 1;

  if v_cli is not null then$$ in v) = 0 or position($$values (upper(v_nom), v_tel,$$ in v) = 0
     or position($$      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora')
      on conflict (customer_id) do nothing;
    end if;$$ in v) = 0 then raise exception 'IDENTIDAD: cliente_prospecto_crear no es la esperada'; end if;
  v := replace(v, $$   limit 1;

  if v_cli is not null then$$, $$   limit 1;
  -- IDENTIDAD (0761) · también por cualquier teléfono de la ficha y por correo
  if v_cli is null then
    v_cli := public._cliente_identidad(v_dig, v_mail, null);
    if v_cli is not null then v_dueno := public._cc_vendedor_de_cliente(v_cli); end if;
  end if;

  if v_cli is not null then$$);
  v := replace(v, $$values (upper(v_nom), v_tel,$$, $$values (v_nom, v_tel,$$);
  v := replace(v, $$      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora')
      on conflict (customer_id) do nothing;
    end if;$$, $$      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora')
      on conflict (customer_id) do nothing;
      insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
      values (v_cli, null, v_uid, v_uid, 'Prospecto registrado por la vendedora');
    end if;
    -- el celular con que se registró es su WhatsApp (el espejo de customers.phone lo dejaba como «otro»)
    update public.customer_phones set etiqueta = 'whatsapp', updated_at = now()
     where customer_id = v_cli and activo and etiqueta = 'otro' and numero_norm = public._c360_tel_norm(v_tel);$$);
  execute v;

  -- 4a. Aprobación por vendedora o Dirección (Conversaciones / WhatsApp)
  v := pg_get_functiondef('public.doctor_verificar'::regproc);
  if position($$  if v_c is null and p.email is not null then
    select count(*), min(id::text)::uuid into v_n, v_c from public.customers where profile_id is null and active and lower(btrim(email)) = lower(btrim(p.email));
    if v_n <> 1 then v_c := null; end if;$$ in v) = 0
     or position($$nullif(p.meta -> 'shipping' ->> 'phone', '')$$ in v) = 0
     or position($$  perform public._ligar_prerregistro(p_profile);$$ in v) = 0 then raise exception 'IDENTIDAD: doctor_verificar no es la esperada'; end if;
  v := replace(v, $$  if v_c is null and p.email is not null then
    select count(*), min(id::text)::uuid into v_n, v_c from public.customers where profile_id is null and active and lower(btrim(email)) = lower(btrim(p.email));
    if v_n <> 1 then v_c := null; end if;$$, $$  if v_c is null then
    -- IDENTIDAD (0761) · su ficha por teléfono, correo o cédula (antes solo correo, y si no, otra ficha)
    v_c := public._cliente_identidad(coalesce(nullif(p.meta -> 'shipping' ->> 'phone', ''), p.meta ->> 'phone'), p.email, p.meta ->> 'cedula', true);
    v_n := case when v_c is null then 0 else 1 end;$$);
  v := replace(v, $$nullif(p.meta -> 'shipping' ->> 'phone', '')$$, $$coalesce(nullif(p.meta -> 'shipping' ->> 'phone', ''), nullif(p.meta ->> 'phone', ''))$$);
  v := replace(v, $$  perform public._ligar_prerregistro(p_profile);$$, $$  perform public._cliente_adopta_registro(v_c, p_profile);   -- IDENTIDAD (0761) · lo del registro pasa a su ficha
  perform public._ligar_prerregistro(p_profile);$$);
  execute v;

  -- 4b. Aprobación de Dirección («Por verificar»)
  v := pg_get_functiondef('public.admin_approve_doctor'::regproc);
  if position($$  elsif p_new_customer is not null then
    select id into v_customer from public.customers where profile_id = p_profile limit 1;
    if v_customer is null then$$ in v) = 0 or position($$  perform public._ligar_prerregistro(p_profile);$$ in v) = 0 then
    raise exception 'IDENTIDAD: admin_approve_doctor no es la esperada'; end if;
  v := replace(v, $$  elsif p_new_customer is not null then
    select id into v_customer from public.customers where profile_id = p_profile limit 1;
    if v_customer is null then$$, $$  elsif p_new_customer is not null then
    select id into v_customer from public.customers where profile_id = p_profile limit 1;
    -- IDENTIDAD (0761) · si ya hay una ficha sin cuenta con su teléfono, correo o cédula, se liga esa (no otra)
    if v_customer is null then
      v_customer := public._cliente_identidad(coalesce(nullif(p_new_customer ->> 'phone', ''), (select coalesce(nullif(meta -> 'shipping' ->> 'phone', ''), meta ->> 'phone') from public.profiles where id = p_profile)),
                                              coalesce(nullif(p_new_customer ->> 'email', ''), (select email from public.profiles where id = p_profile)),
                                              (select meta ->> 'cedula' from public.profiles where id = p_profile), true);
      if v_customer is not null then update public.customers set profile_id = p_profile, updated_at = now() where id = v_customer; end if;
    end if;
    if v_customer is null then$$);
  v := replace(v, $$  perform public._ligar_prerregistro(p_profile);$$, $$  -- IDENTIDAD (0761) · la vendedora que eligió Dirección queda en la CARTERA (antes solo en seller_name, que nadie lee)
  if not exists (select 1 from public.cc_cartera where profile_id = p_profile)
     and (p_new_customer -> 'meta' ->> 'seller_profile_id') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.profiles s where s.id = (p_new_customer -> 'meta' ->> 'seller_profile_id')::uuid and s.role_id = 'pos' and s.active) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (p_profile, (p_new_customer -> 'meta' ->> 'seller_profile_id')::uuid, now(), auth.uid(), 'Asignada por Dirección al aprobar');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
    values (p_profile, null, (p_new_customer -> 'meta' ->> 'seller_profile_id')::uuid, auth.uid(), 'Asignada por Dirección al aprobar');
  end if;
  perform public._cliente_adopta_registro(v_customer, p_profile);   -- lo del registro pasa a su ficha
  perform public._ligar_prerregistro(p_profile);$$);
  execute v;

  -- 5. Alta desde el chat: también el duplicado por teléfono
  v := pg_get_functiondef('public.cc_alta_cliente_conversacion'::regproc);
  if position($$  if v_tel is null then select public.norm_telefono_mx(r.telefono) into v_tel from public.cc_prerregistros r where r.visitor_id = c.visitor_id; end if;$$ in v) = 0 then
    raise exception 'IDENTIDAD: cc_alta_cliente_conversacion no es la esperada'; end if;
  v := replace(v, $$  if v_tel is null then select public.norm_telefono_mx(r.telefono) into v_tel from public.cc_prerregistros r where r.visitor_id = c.visitor_id; end if;$$,
                  $$  if v_tel is null then select public.norm_telefono_mx(r.telefono) into v_tel from public.cc_prerregistros r where r.visitor_id = c.visitor_id; end if;
  -- IDENTIDAD (0761) · ¿ya hay ficha con ese teléfono? (antes solo correo o cédula)
  if v_tel is not null and public._cliente_identidad(v_tel, null, null) is not null then
    raise exception 'POSIBLE_DUPLICADO: ya hay una ficha con ese teléfono; búscala y vincúlala' using errcode = 'check_violation';
  end if;$$);
  execute v;
end $m$;

revoke all on function public._cliente_identidad(text, text, text, boolean), public._especialidad_de_texto(text),
  public._cliente_especialidad_si_falta(uuid, text), public._cliente_adopta_registro(uuid, uuid) from public, anon, authenticated;
grant execute on function public._cliente_especialidad_si_falta(uuid, text) to service_role;   -- la usa la Edge alta-whatsapp
