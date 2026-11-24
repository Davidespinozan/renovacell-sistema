-- 0783 down: vuelve a 0782 (en «Ventas» el dueño es vendedor con límites y entra al reparto).

CREATE OR REPLACE FUNCTION public.auth_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select case when not p.active then public._cuenta_suspendida()
                 -- DUEÑO · «Ver como › Ventas»: el dueño actúa como vendedor (solo hacia abajo; ver 0782)
                 when p.role_id = 'admin' and coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'dueno'
                      and (nullif(current_setting('request.headers', true), '')::json ->> 'x-actuar-como') = 'pos' then 'pos'
                 else p.role_id end
       from public.profiles p where p.id = auth.uid()),
    '');
$function$;

CREATE OR REPLACE FUNCTION public._cc_vendedor_turno(p_excluir uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s uuid;
begin
  select p.id into s from public.profiles p left join public.cc_reparto_turnos t on t.seller_profile_id = p.id
   where public._es_vendedor_rol(p.role_id, p.meta) and not coalesce(p.interna, false) and public._cc_vendedor_elegible(p.id, true) and not (p.id = any (coalesce(p_excluir, '{}')))
   order by t.ultimo_at asc nulls first, random() limit 1;
  if s is not null then
    insert into public.cc_reparto_turnos as t (seller_profile_id, ultimo_at, recibidos) values (s, clock_timestamp(), 1)
    on conflict (seller_profile_id) do update set ultimo_at = clock_timestamp(), recibidos = t.recibidos + 1;
  end if;
  return s;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_atencion_config_ver()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg record;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_atencion_config where id = 1;
  return jsonb_build_object('aviso_min', cfg.aviso_min, 'escalamiento_min', cfg.escalamiento_min, 'pausar_fuera_horario', cfg.pausar_fuera_horario, 'updated_at', cfg.updated_at,
                            'horario', public._cc_horario_estado(now()),
                            -- Chat V2-C2 · ciclo de vida de sesiones (NULL = desactivado; tiempo de reloj)
                            'sesiones', jsonb_build_object('ia_min', cfg.sesion_ia_min, 'humana_min', cfg.sesion_humana_min, 'aviso_previo_min', cfg.sesion_aviso_previo_min, 'solicitud_min', cfg.solicitud_expira_min),
                            -- REPARTO (181)
                            'reparto', jsonb_build_object('activo', cfg.reparto_activo, 'min', cfg.reparto_min, 'fija_cartera', cfg.reparto_fija_cartera,
                                                          'vendedores_elegibles', (select count(*) from public.profiles p where public._es_vendedor_rol(p.role_id, p.meta) and not p.interna and public._cc_vendedor_elegible(p.id, true))));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_ruteo_resumen()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'horario', public._cc_horario_estado(now()),
    'sin_vendedor', (select count(*) from public.profiles p where p.role_id = 'doctor' and p.active and not exists (select 1 from public.cc_cartera k where k.profile_id = p.id)),
    'reasignacion', (select count(*) from public.cc_cartera k where not public._cc_vendedor_elegible(k.seller_profile_id, false) and not exists (select 1 from public.profiles s where s.id = k.seller_profile_id and s.interna)),
    'handoffs_sin_asignar', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null),
    'handoffs_pendientes', (select count(*) from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'),
    'vendedores_elegibles', (select count(*) from public.profiles p where public._es_vendedor_rol(p.role_id, p.meta) and not p.interna and public._cc_vendedor_elegible(p.id, false)),
    -- REPARTO (181)
    'reparto_activo', (select reparto_activo from public.cc_atencion_config where id = 1),
    'reparto_en_curso', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_assigned' and c.ruteo_motivo = 'reparto'),
    'vendedores_elegibles_nuevos', (select count(*) from public.profiles p where public._es_vendedor_rol(p.role_id, p.meta) and not p.interna and public._cc_vendedor_elegible(p.id, true)));
end;
$function$;

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
  -- IDENTIDAD (0761) · también por cualquier teléfono de la ficha y por correo
  if v_cli is null then
    v_cli := public._cliente_identidad(v_dig, v_mail, null);
    if v_cli is not null then v_dueno := public._cc_vendedor_de_cliente(v_cli); end if;
  end if;

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
    values (v_nom, v_tel, v_mail, nullif(btrim(coalesce(p_ciudad, '')), ''), 'MX', 'vendedor', coalesce(p_tipo, 'doctor'),
            jsonb_build_object('prospecto', jsonb_build_object('por', v_uid, 'at', now())))
    returning id into v_cli;
    if v_rol = 'pos' then
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_por, motivo)
      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora')
      on conflict (customer_id) do nothing;
      insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
      values (v_cli, null, v_uid, v_uid, 'Prospecto registrado por la vendedora');
    end if;
    -- el celular con que se registró es su WhatsApp (el espejo de customers.phone lo dejaba como «otro»)
    update public.customer_phones set etiqueta = 'whatsapp', updated_at = now()
     where customer_id = v_cli and activo and etiqueta = 'otro' and numero_norm = public._c360_tel_norm(v_tel);
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
  if v_ced !~ '^[0-9]{5,8}$' then raise exception 'DATO_INVALIDO:cedula' using errcode = 'check_violation'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'DATO_INVALIDO:email' using errcode = 'check_violation'; end if;
  -- Ya existe (por correo o cédula): se vincula esa ficha, no se duplica (sin revelar de quién es).
  if exists (select 1 from public.customers x where (v_mail is not null and lower(x.email) = v_mail) or regexp_replace(coalesce(x.meta ->> 'cedula', ''), '[^0-9]', '', 'g') = v_ced)
     or exists (select 1 from public.profiles p where regexp_replace(coalesce(p.meta ->> 'cedula', ''), '[^0-9]', '', 'g') = v_ced) then
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
  -- IDENTIDAD (0761) · ¿ya hay ficha con ese teléfono? (antes solo correo o cédula)
  if v_tel is not null and public._cliente_identidad(v_tel, null, null) is not null then
    raise exception 'POSIBLE_DUPLICADO: ya hay una ficha con ese teléfono; búscala y vincúlala' using errcode = 'check_violation';
  end if;

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

CREATE OR REPLACE FUNCTION public.cc_vincular_cliente(p_conv uuid, p_customer uuid, p_guardar_numero boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; cu record; v_rol text := public.auth_role(); s uuid; v_tel text; v_num boolean := false; v_cart boolean := false; v_reas boolean := false;
begin
  if not public._cc_puede_ver_conv(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.profile_id is not null then raise exception 'CONVERSACION_CON_CUENTA: esta persona ya tiene cuenta; su ficha se liga sola' using errcode = 'check_violation'; end if;
  select id, full_name, phone, profile_id, active into cu from public.customers where id = p_customer for update;
  if not found or exists (select 1 from public.c4a_exclusiones e where e.customer_id = p_customer) then raise exception 'CLIENTE_INEXISTENTE' using errcode = 'check_violation'; end if;
  if not cu.active then raise exception 'CLIENTE_INACTIVO: reactiva al cliente antes de vincularlo' using errcode = 'check_violation'; end if;
  if c.customer_id is not distinct from p_customer then
    return jsonb_build_object('customer_id', p_customer, 'idempotente', true);
  end if;
  update public.cc_conversations set customer_id = p_customer, updated_at = now() where id = p_conv;

  -- El número desde el que escribe queda en su ficha: la próxima vez se reconoce y llega a su vendedor.
  if coalesce(p_guardar_numero, true) then
    select public.norm_telefono_mx(w.wa_id) into v_tel from public.cc_wa_contactos w where w.visitor_id = c.visitor_id order by w.ultimo_entrante_at desc nulls last limit 1;
    if v_tel ~ '^[0-9]{10}$' and public.norm_telefono_mx(cu.phone) is distinct from v_tel
       and not exists (select 1 from public.customer_phones p where p.customer_id = p_customer and p.activo and p.numero_norm = v_tel) then
      insert into public.customer_phones (customer_id, numero, numero_norm, etiqueta, es_principal, activo, origen, created_by)
      values (p_customer, v_tel, v_tel, 'whatsapp', false, true, 'manual', auth.uid());
      perform public._c360_evento(p_customer, 'telefono_agregado', jsonb_build_object('numero', '••••' || right(v_tel, 4), 'origen', 'conversacion'), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
      v_num := true;
    end if;
  end if;

  -- Sin vendedor: quien la vincula (vendedor que puede recibir clientes) la toma, como en el reparto.
  s := public._cc_vendedor_de_cliente(p_customer);
  if s is null and v_rol = 'pos' and public._cc_vendedor_elegible(auth.uid(), false) then
    if cu.profile_id is null then
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_customer, auth.uid(), now(), auth.uid(), 'Vinculado desde una conversación');
      insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_customer, null, auth.uid(), auth.uid(), 'Vinculado desde una conversación');
    else
      insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (cu.profile_id, auth.uid(), now(), auth.uid(), 'Vinculado desde una conversación') on conflict (profile_id) do nothing;
      insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (cu.profile_id, null, auth.uid(), auth.uid(), 'Vinculado desde una conversación');
    end if;
    perform public._c360_evento(p_customer, 'vendedor_asignado', jsonb_build_object('vendedor', auth.uid(), 'por', 'conversacion'), 'vendedor');
    s := auth.uid(); v_cart := true;
  end if;

  -- La conversación va al vendedor de SU cartera (si está pidiendo o recibiendo atención y ese vendedor puede atender).
  if s is not null and c.modo in ('human_requested', 'human_assigned', 'human_active') and c.seller_profile_id is distinct from s and public._cc_vendedor_elegible(s, false) then
    perform public._cc_handler_asignar(p_conv, s, case when v_rol = 'admin' then 'admin' else 'seller' end, auth.uid(), 'cliente_vinculado', 'cartera');
    v_reas := true;
  end if;

  insert into public.cc_conversacion_cliente_hist (conversation_id, customer_anterior, customer_nuevo, actor_profile_id, detalle)
  values (p_conv, c.customer_id, p_customer, auth.uid(), jsonb_build_object('numero_guardado', v_num, 'cartera_asignada', v_cart, 'reasignada', v_reas));
  return jsonb_build_object('customer_id', p_customer, 'idempotente', false, 'numero_guardado', v_num, 'cartera_asignada', v_cart, 'reasignada', v_reas,
    'vendedor', s, 'vendedor_nombre', (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = s));
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
  if v_c is null then
    -- IDENTIDAD (0761) · su ficha por teléfono, correo o cédula (antes solo correo, y si no, otra ficha)
    v_c := public._cliente_identidad(coalesce(coalesce(nullif(p.meta -> 'shipping' ->> 'phone', ''), nullif(p.meta ->> 'phone', '')), p.meta ->> 'phone'), p.email, p.meta ->> 'cedula', true);
    v_n := case when v_c is null then 0 else 1 end;
    if v_c is not null then update public.customers set profile_id = p_profile, updated_at = now() where id = v_c; end if;
  end if;
  if v_c is null then
    insert into public.customers (full_name, email, phone, city, source, profile_id, active)
    values (coalesce(nullif(p.full_name, ''), p.meta ->> 'name', 'Doctor'), p.email, coalesce(nullif(p.meta -> 'shipping' ->> 'phone', ''), nullif(p.meta ->> 'phone', '')), nullif(p.meta -> 'shipping' ->> 'city', ''), 'portal', p_profile, true)
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
  perform public._cliente_adopta_registro(v_c, p_profile);   -- IDENTIDAD (0761) · lo del registro pasa a su ficha
  perform public._ligar_prerregistro(p_profile);   -- otro dispositivo: su conversación del enlace pasa a su cuenta
  perform public._c360_evento(v_c, 'verificacion_aprobada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  perform public._cc_notificar('verificacion_aprobada', null, array[p_profile], null, 'Tu cuenta Renovacell fue verificada: ya puedes ver precios y hacer pedidos.', 'catalogo', 'verif_ok:' || p_profile::text);
  return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'customer_id', v_c, 'idempotente', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_cotizacion_crear(p_customer uuid, p_lineas jsonb, p_notas text DEFAULT NULL::text, p_conversation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cu record; v_list uuid; l jsonb; pr record; q int; up numeric; v_lineas jsonb := '[]'::jsonb; v_sub numeric := 0; v_id uuid; r public.cotizaciones; v_vq jsonb;
begin
  perform public._cot_exige(p_customer);
  select id, profile_id, active into cu from public.customers where id = p_customer;
  if not cu.active then raise exception 'CLIENTE_INACTIVO' using errcode = 'check_violation'; end if;
  if p_conversation is not null and not (public._cc_puede_ver_conv(p_conversation)
       and exists (select 1 from public.cc_conversations c where c.id = p_conversation and (c.customer_id = p_customer or (c.profile_id is not null and c.profile_id = cu.profile_id)))) then
    raise exception 'CONVERSACION_AJENA: la conversación no es de este cliente' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 60 then raise exception 'LINEAS_INVALIDAS' using errcode = 'check_violation'; end if;
  v_list := (select p.price_list_id from public.profiles p where p.id = cu.profile_id);
  v_vq := public._qty_volumen(p_lineas);   -- MAYOREO-REGLAS
  for l in select * from jsonb_array_elements(p_lineas) loop
    q := (l ->> 'qty')::int;
    if q is null or q < 1 or q > 999 then raise exception 'LINEAS_INVALIDAS: cantidad' using errcode = 'check_violation'; end if;
    select id, name, sku, price, active, sellable into pr from public.products where id = (l ->> 'product_id')::uuid;
    if not found or not coalesce(pr.active, false) or pr.sellable is false or pr.price is null then raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(pr.name, l ->> 'product_id') using errcode = 'check_violation'; end if;
    up := public.precio_de(pr.id, v_list, q, coalesce((v_vq ->> pr.id::text)::int, q));
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'nombre', pr.name, 'sku', pr.sku, 'qty', q, 'unit_price', up, 'precio_lista', pr.price, 'subtotal', round(up * q, 2)));
    v_sub := v_sub + round(up * q, 2);
  end loop;
  insert into public.cotizaciones (customer_id, conversation_id, seller_profile_id, vigente_hasta, lineas, subtotal, total, notas, created_by)
  values (p_customer, p_conversation, coalesce(public._cc_vendedor_de_cliente(p_customer), case when public.auth_role() = 'pos' then auth.uid() end),
          now() + interval '7 days', v_lineas, v_sub, v_sub, nullif(btrim(coalesce(p_notas, '')), ''), auth.uid())
  returning * into r;
  return to_jsonb(r);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_mi_enlace()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_role text := public.auth_role(); v_cod text; v_cust uuid; v_seller uuid; v_nom text;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO'; end if;
  if v_role = 'pos' then
    if not public._cc_vendedor_elegible(v_uid, false) then raise exception 'NO_AUTORIZADO: tu cuenta no atiende conversaciones'; end if;
    v_cod := public._cc_enlace_de_vendedor(v_uid);
    return jsonb_build_object('tipo', 'vendedor', 'codigo', v_cod, 'cifras', public._cc_enlace_cifras(v_cod));
  elsif v_role = 'doctor' then
    select id into v_cust from public.customers where profile_id = v_uid order by created_at limit 1;
    if v_cust is null then raise exception 'SIN_FICHA: aún no tienes ficha de cliente'; end if;
    v_cod := public._cc_enlace_de_cliente(v_cust);
    v_seller := public._cc_vendedor_de_cliente(v_cust);
    v_nom := public._cc_nombre_personal(v_seller);
    return jsonb_build_object('tipo', 'referido', 'codigo', v_cod, 'cifras', public._cc_enlace_cifras(v_cod),
      'asesor', case when v_seller is not null and public._cc_vendedor_elegible(v_seller, false) then jsonb_build_object('nombre', v_nom, 'primer_nombre', public._cc_primer_nombre(v_nom)) end);
  end if;
  raise exception 'NO_AUTORIZADO';
end;
$function$;

drop function if exists public._actua_como_vendedor();
