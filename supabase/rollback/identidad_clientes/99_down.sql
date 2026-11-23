-- IDENTIDAD (0761) · down: cada puerta vuelve a su búsqueda anterior y la aprobación deja de pasar el registro a la ficha.

CREATE OR REPLACE FUNCTION public.cliente_prospecto_crear(p_nombre text, p_celular text, p_tipo text DEFAULT 'doctor'::text, p_ciudad text DEFAULT NULL::text, p_correo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rol text := public.auth_role(); v_uid uuid := auth.uid();
  v_nom text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
  v_dig text := regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  v_mail text := nullif(lower(btrim(coalesce(p_correo, ''))), '');
  v_tel text; v_cli uuid; v_dueno uuid; v_estado text; v_op jsonb;
begin
  if v_rol not in ('pos', 'admin') then raise exception 'NO_AUTORIZADO: solo Ventas o Dirección registran prospectos' using errcode = 'insufficient_privilege'; end if;
  if v_nom is null or length(v_nom) < 3 or length(v_nom) > 120 then raise exception 'NOMBRE_REQUERIDO: escribe el nombre completo' using errcode = 'check_violation'; end if;
  if length(v_dig) = 12 and left(v_dig, 2) = '52' then v_dig := right(v_dig, 10); end if;
  if length(v_dig) = 13 and left(v_dig, 3) = '521' then v_dig := right(v_dig, 10); end if;
  if public._wa_id_de_digitos(v_dig) is null then raise exception 'CELULAR_INVALIDO: escribe el celular a 10 dígitos (México) o con su lada si es del extranjero (p. ej. +1 737 …)' using errcode = 'check_violation'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'CORREO_INVALIDO: revisa el correo' using errcode = 'check_violation'; end if;
  if coalesce(p_tipo, 'doctor') not in ('doctor', 'clinica') then raise exception 'TIPO_INVALIDO' using errcode = 'check_violation'; end if;
  v_tel := case when length(v_dig) = 10 then v_dig else '+' || v_dig end;   -- WA-INTL · extranjero con su lada

  -- ¿ese celular ya existe? (el más completo: con vendedora primero)
  select c.id, public._cc_vendedor_de_cliente(c.id) into v_cli, v_dueno
    from public.customers c
   where c.active and public._wa_id_de_digitos(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) = public._wa_id_de_digitos(v_dig)
   order by (public._cc_vendedor_de_cliente(c.id) is not null) desc, (c.email is not null) desc, c.created_at
   limit 1;

  if v_cli is not null then
    if v_dueno is not null and v_dueno <> v_uid and v_rol = 'pos' then
      raise exception 'PROSPECTO_DE_OTRA: ese celular ya es de «%», cliente de %. Si crees que debe ser tuyo, pídeselo a Dirección',
        (select initcap(lower(full_name)) from public.customers where id = v_cli),
        coalesce(public._cc_nombre_personal(v_dueno), 'otra vendedora') using errcode = 'check_violation';
    end if;
    if v_dueno is null and v_rol = 'pos' then
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_por, motivo)
      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora (ya existía sin vendedora)')
      on conflict (customer_id) do nothing;
      perform public._c360_evento(v_cli, 'vendedor_asignado', jsonb_build_object('vendedor', v_uid, 'motivo', 'prospecto'), v_rol);
      v_estado := 'asignado';
    else
      v_estado := 'existente';
    end if;
  else
    insert into public.customers (full_name, phone, email, city, country, source, tipo_cliente, meta)
    values (upper(v_nom), v_tel, v_mail, nullif(btrim(coalesce(p_ciudad, '')), ''), 'MX', 'vendedor', coalesce(p_tipo, 'doctor'),
            jsonb_build_object('prospecto', jsonb_build_object('por', v_uid, 'at', now())))
    returning id into v_cli;
    if v_rol = 'pos' then
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_por, motivo)
      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora')
      on conflict (customer_id) do nothing;
    end if;
    perform public._c360_evento(v_cli, 'nota_agregada', jsonb_build_object('nota', 'Alta como prospecto', 'por', v_uid), v_rol);
    v_estado := 'creado';
  end if;

  -- su oportunidad en «Primer contacto» (si ya tiene una abierta, se respeta)
  begin
    v_op := public.crm_crear(v_cli, 'Prospecto', null);
  exception when others then v_op := null;
  end;

  insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
  values (v_uid, 'Prospecto registrado', 'customers', v_cli::text, jsonb_build_object('estado', v_estado, 'nombre', upper(v_nom)));

  return jsonb_build_object('status', v_estado, 'customer_id', v_cli,
    'nombre', (select full_name from public.customers where id = v_cli), 'phone', (select phone from public.customers where id = v_cli),
    'oportunidad_id', v_op ->> 'id');
end;
$function$;

CREATE OR REPLACE FUNCTION public.doctor_verificar(p_profile uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Aprueba o rechaza la verificación de un doctor. Aprobar = su expediente de cliente queda ligado (el que ya tenía,
-- el único con su mismo correo sin cuenta, o uno nuevo) y la cuenta se verifica. Quién lo aprobó queda registrado.
declare p record; v_c uuid; v_nota text := nullif(btrim(left(coalesce(p_nota, ''), 300)), ''); v_rol text := public.auth_role();
        v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_n int;
begin
  if not public._puede_verificar(p_profile) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  if p_aprobar is null then raise exception 'DECISION_INVALIDA' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_profile::text));
  select id, full_name, email, verified, meta into p from public.profiles where id = p_profile and role_id = 'doctor' for update;
  if not found then raise exception 'DOCTOR_INEXISTENTE' using errcode = 'check_violation'; end if;
  if p.verified then return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'idempotente', true); end if;
  if not p_aprobar then
    if v_nota is null then raise exception 'NOTA_REQUERIDA: explica por qué se rechaza' using errcode = 'check_violation'; end if;
    perform set_config('app.trusted', 'on', true);
    update public.profiles set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'rejected', 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'reason', v_nota)) where id = p_profile;
    perform set_config('app.trusted', v_trusted, true);
    select id into v_c from public.customers where profile_id = p_profile limit 1;
    if v_c is not null then perform public._c360_evento(v_c, 'verificacion_rechazada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end); end if;
    -- Aviso al doctor dentro del sistema (el portal además lo detecta solo): el motivo lo ve en "Mi verificación".
    perform public._cc_notificar('verificacion_rechazada', null, array[p_profile], null, 'Tu verificación no fue aprobada: ' || v_nota || '. Corrige tus datos en "Mi verificación".', 'mi_verificacion', 'verif_rechazo:' || p_profile::text || ':' || extract(epoch from now())::bigint::text);
    return jsonb_build_object('profile_id', p_profile, 'verificado', false, 'estado', 'rejected');
  end if;
  select id into v_c from public.customers where profile_id = p_profile order by active desc, created_at limit 1;
  if v_c is null and p.email is not null then
    select count(*), min(id::text)::uuid into v_n, v_c from public.customers where profile_id is null and active and lower(btrim(email)) = lower(btrim(p.email));
    if v_n <> 1 then v_c := null; end if;
    if v_c is not null then update public.customers set profile_id = p_profile, updated_at = now() where id = v_c; end if;
  end if;
  if v_c is null then
    insert into public.customers (full_name, email, phone, city, source, profile_id, active)
    values (coalesce(nullif(p.full_name, ''), p.meta ->> 'name', 'Doctor'), p.email, nullif(p.meta -> 'shipping' ->> 'phone', ''), nullif(p.meta -> 'shipping' ->> 'city', ''), 'portal', p_profile, true)
    returning id into v_c;
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.profiles set verified = true,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'verified', 'via', case when v_rol = 'admin' then 'direccion' else 'vendedor' end, 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'reason', v_nota))
   where id = p_profile;
  perform set_config('app.trusted', v_trusted, true);
  if v_rol = 'pos' and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_profile, auth.uid(), now(), auth.uid(), 'Lo verificó su vendedor');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_profile, null, auth.uid(), auth.uid(), 'Lo verificó su vendedor');
  end if;
  perform public._ligar_prerregistro(p_profile);   -- otro dispositivo: su conversación del enlace pasa a su cuenta
  perform public._c360_evento(v_c, 'verificacion_aprobada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  perform public._cc_notificar('verificacion_aprobada', null, array[p_profile], null, 'Tu cuenta Renovacell fue verificada: ya puedes ver precios y hacer pedidos.', 'catalogo', 'verif_ok:' || p_profile::text);
  return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'customer_id', v_c, 'idempotente', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_approve_doctor(p_profile uuid, p_customer_id uuid DEFAULT NULL::uuid, p_new_customer jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer uuid;
  v_existing uuid;
begin
  if not (coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
          or public.auth_role() = 'admin') then
    raise exception 'No autorizado: solo Administración puede aprobar doctores.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and role_id = 'doctor') then
    raise exception 'Perfil de doctor no encontrado.';
  end if;

  if p_customer_id is not null then
    select profile_id into v_existing from public.customers where id = p_customer_id;
    if not found then raise exception 'Cliente no encontrado.'; end if;
    if v_existing is not null and v_existing <> p_profile then
      raise exception 'Ese cliente ya está vinculado a otro portal.';
    end if;
    update public.customers set profile_id = p_profile, updated_at = now() where id = p_customer_id;
    v_customer := p_customer_id;
  elsif p_new_customer is not null then
    select id into v_customer from public.customers where profile_id = p_profile limit 1;
    if v_customer is null then
      -- Preserva TODO el contexto comercial disponible: seller_name (columna) y
      -- organization/notes (meta). NULL/'' nunca fabrica valores.
      insert into public.customers (full_name, email, phone, city, source, seller_name, profile_id, meta)
      values (
        coalesce(nullif(p_new_customer->>'full_name',''), (select full_name from public.profiles where id = p_profile), 'Doctor'),
        nullif(p_new_customer->>'email',''),
        nullif(p_new_customer->>'phone',''),
        nullif(p_new_customer->>'city',''),
        coalesce(nullif(p_new_customer->>'source',''), 'portal'),
        nullif(p_new_customer->>'seller_name',''),
        p_profile,
        coalesce(p_new_customer->'meta', '{}'::jsonb)
      )
      returning id into v_customer;
    end if;
  else
    raise exception 'Debes vincular un cliente existente o crear uno nuevo.';
  end if;

  update public.profiles
     set verified = true,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
           'verification', jsonb_build_object('status', 'verified', 'reviewed_at', now(), 'reviewed_by', auth.uid())
         )
   where id = p_profile;

  perform public._ligar_prerregistro(p_profile);   -- otro dispositivo: su conversación del enlace pasa a su cuenta

  -- Cierra el lazo prospect ↔ customer para conversiones (determinista: convertedDoctorId = ESTE profile).
  update public.prospects
     set customer_id = v_customer
   where customer_id is null
     and meta->>'convertedDoctorId' = p_profile::text;

  return jsonb_build_object('ok', true, 'customer_id', v_customer);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_alta_cliente_conversacion(p_conv uuid, p_nombre text, p_cedula text, p_email text DEFAULT NULL::text, p_ciudad text DEFAULT NULL::text, p_ine_frente uuid DEFAULT NULL::uuid, p_ine_reverso uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; v_rol text := public.auth_role(); v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_ced text := regexp_replace(coalesce(p_cedula, ''), '[^0-9]', '', 'g'); v_mail text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_tel text; v_id uuid; s uuid; v_ine uuid;
begin
  if not public._cc_puede_ver_conv(p_conv) or v_rol not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.profile_id is not null then raise exception 'CONVERSACION_CON_CUENTA: esta persona ya tiene cuenta; su ficha se liga sola' using errcode = 'check_violation'; end if;
  if c.customer_id is not null then raise exception 'YA_VINCULADA: esta conversación ya tiene ficha' using errcode = 'check_violation'; end if;
  if char_length(v_nombre) < 5 or v_nombre !~ '\S+\s+\S+' or char_length(v_nombre) > 120 then raise exception 'DATO_INVALIDO:nombre' using errcode = 'check_violation'; end if;
  if v_ced !~ '^[0-9]{7,8}$' then raise exception 'DATO_INVALIDO:cedula' using errcode = 'check_violation'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'DATO_INVALIDO:email' using errcode = 'check_violation'; end if;
  -- Ya existe (por correo o cédula): se vincula esa ficha, no se duplica (sin revelar de quién es).
  if exists (select 1 from public.customers x where (v_mail is not null and lower(x.email) = v_mail) or x.meta ->> 'cedula' = v_ced)
     or exists (select 1 from public.profiles p where p.meta ->> 'cedula' = v_ced) then
    raise exception 'POSIBLE_DUPLICADO: ya hay una ficha con ese correo o cédula; búscala y vincúlala' using errcode = 'check_violation';
  end if;
  -- INE: fotos de ESTA conversación que mandó quien escribe.
  foreach v_ine in array array_remove(array[p_ine_frente, p_ine_reverso], null) loop
    if not exists (select 1 from public.cc_adjuntos ad join public.cc_messages m on m.id = ad.message_id
                    where ad.id = v_ine and ad.conversation_id = p_conv and m.actor_type = 'visitor') then
      raise exception 'ADJUNTO_NO_ES_DEL_CLIENTE: la foto de la INE debe ser una que mandó esta persona en esta conversación' using errcode = 'check_violation';
    end if;
  end loop;
  select public.norm_telefono_mx(w.wa_id) into v_tel from public.cc_wa_contactos w where w.visitor_id = c.visitor_id order by w.ultimo_entrante_at desc nulls last limit 1;
  if v_tel is null then select public.norm_telefono_mx(r.telefono) into v_tel from public.cc_prerregistros r where r.visitor_id = c.visitor_id; end if;

  insert into public.customers (full_name, email, phone, city, source, active, meta)
  values (v_nombre, v_mail, v_tel, nullif(btrim(coalesce(p_ciudad, '')), ''), 'conversacion', true,
          jsonb_build_object('cedula', v_ced, 'alta', jsonb_build_object('por', auth.uid(), 'at', now(), 'conversacion', p_conv, 'ine', p_ine_frente is not null or p_ine_reverso is not null)))
  returning id into v_id;
  perform public._c360_evento(v_id, 'verificacion_aprobada', jsonb_build_object('cedula', '••••' || right(v_ced, 3), 'origen', 'conversacion',
          'ine_frente', p_ine_frente is not null, 'ine_reverso', p_ine_reverso is not null), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  update public.cc_adjuntos set uso = 'ine-front', usado_por = auth.uid(), usado_at = now() where id = p_ine_frente;
  update public.cc_adjuntos set uso = 'ine-back', usado_por = auth.uid(), usado_at = now() where id = p_ine_reverso;

  -- Cartera: el vendedor que lo atiende (quien lo da de alta, o el asignado a la conversación si lo da de alta Dirección).
  s := case when v_rol = 'pos' then auth.uid() else c.seller_profile_id end;
  if s is not null then
    insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo) values (v_id, s, now(), auth.uid(), 'Alta desde una conversación');
    insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (v_id, null, s, auth.uid(), 'Alta desde una conversación');
    perform public._c360_evento(v_id, 'vendedor_asignado', jsonb_build_object('vendedor', s, 'por', 'alta_conversacion'), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  end if;
  update public.cc_conversations set customer_id = v_id, updated_at = now() where id = p_conv;
  insert into public.cc_conversacion_cliente_hist (conversation_id, customer_anterior, customer_nuevo, actor_profile_id, detalle)
  values (p_conv, null, v_id, auth.uid(), jsonb_build_object('accion', 'alta', 'cartera', s));
  return jsonb_build_object('customer_id', v_id, 'nombre', v_nombre, 'vendedor', s);
end;
$function$;

drop function if exists public._cliente_adopta_registro(uuid, uuid);
drop function if exists public._cliente_especialidad_si_falta(uuid, text);
drop function if exists public._especialidad_de_texto(text);
drop function if exists public._cliente_identidad(text, text, text, boolean);
