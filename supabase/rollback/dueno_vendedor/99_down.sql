-- 0782 down: el dueño deja de contar como vendedor y auth_role() ignora x-actuar-como.

CREATE OR REPLACE FUNCTION public.auth_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select case when p.active then p.role_id else public._cuenta_suspendida() end
       from public.profiles p where p.id = auth.uid()),
    '');
$function$;

CREATE OR REPLACE FUNCTION public._cc_cartera_al_atender()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; v_ok boolean;
begin
  if new.actor_profile_id is null then return new; end if;
  if not coalesce((select reparto_fija_cartera from public.cc_atencion_config where id = 1), true) then return new; end if;
  select p.role_id = 'pos' and not coalesce(p.interna, false) into v_ok from public.profiles p where p.id = new.actor_profile_id;
  if not coalesce(v_ok, false) then return new; end if;
  select * into c from public.cc_conversations where id = new.conversation_id;
  if not found or public._cc_vendedor_conv(c.id) is not null then return new; end if;   -- gana la cartera
  -- El reparto fija su propia cartera al iniciar (cc_iniciar_asesoria, con su motivo e historial): no se duplica aquí.
  if c.ruteo_motivo = 'reparto' and c.profile_id is not null then return new; end if;
  if c.profile_id is not null then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (c.profile_id, new.actor_profile_id, now(), new.actor_profile_id, 'Atendió su asesoría') on conflict (profile_id) do nothing;
    if found then insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (c.profile_id, null, new.actor_profile_id, new.actor_profile_id, 'Atendió su asesoría'); end if;
  elsif c.customer_id is not null then
    insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (c.customer_id, new.actor_profile_id, now(), new.actor_profile_id, 'Atendió su asesoría') on conflict (customer_id) do nothing;
    if found then insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (c.customer_id, null, new.actor_profile_id, new.actor_profile_id, 'Atendió su asesoría'); end if;
  elsif c.visitor_id is not null then
    -- Un plazo vencido se reemplaza (el contacto ya estaba libre).
    insert into public.cc_cartera_prospectos (visitor_id, seller_profile_id, motivo) values (c.visitor_id, new.actor_profile_id, 'Atendió su asesoría')
    on conflict (visitor_id) do update set seller_profile_id = excluded.seller_profile_id, asignado_at = now(), plazo_desde = now(), motivo = excluded.motivo
      where now() >= cc_cartera_prospectos.plazo_desde + make_interval(days => public._cc_cartera_plazo());
  else return new;
  end if;
  insert into public.cc_cartera_eventos (seller_profile_id, tipo, profile_id, customer_id, visitor_id)
  values (new.actor_profile_id, 'asignado', c.profile_id, case when c.profile_id is null then c.customer_id end, case when c.profile_id is null and c.customer_id is null then c.visitor_id end);
  return new;
exception when others then
  raise warning 'CARTERA-PLAZO: no se fijó la cartera (%): la asesoría sigue', sqlerrm;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_vendedor_elegible(p_profile uuid, p_nuevos boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select p.active and p.role_id = 'pos' and not coalesce(p.interna, false)
                          and coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones'
                          and (not p_nuevos or coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'nuevos_clientes')
                     from public.profiles p where p.id = p_profile), false)
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
   where p.role_id = 'pos' and not coalesce(p.interna, false) and public._cc_vendedor_elegible(p.id, true) and not (p.id = any (coalesce(p_excluir, '{}')))
   order by t.ultimo_at asc nulls first, random() limit 1;
  if s is not null then
    insert into public.cc_reparto_turnos as t (seller_profile_id, ultimo_at, recibidos) values (s, clock_timestamp(), 1)
    on conflict (seller_profile_id) do update set ultimo_at = clock_timestamp(), recibidos = t.recibidos + 1;
  end if;
  return s;
end;
$function$;

CREATE OR REPLACE FUNCTION public._cx0c_atribucion(p_customer uuid, p_doctor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_p uuid; v_odoo text; v_seller uuid; v_ok boolean; v_email text; v_previo text;
begin
  if p_customer is not null then
    select c.profile_id, nullif(btrim(c.seller_name), '') into v_p, v_odoo from public.customers c where c.id = p_customer;
  else
    v_p := p_doctor;
  end if;

  -- 1) cartera del portal (persona con cuenta)
  if v_p is not null then
    select k.seller_profile_id into v_seller from public.cc_cartera k where k.profile_id = v_p;
  end if;
  -- 2) cartera del cliente (cuenta comercial, con o sin portal)
  if v_seller is null and p_customer is not null then
    select k.seller_profile_id into v_seller from public.cc_cartera_clientes k where k.customer_id = p_customer;
  end if;
  -- 3) vendedor Odoo de la cuenta, solo por equivalencia confirmada por el dueño
  if v_seller is null and v_odoo is not null then
    select e.seller_profile_id into v_seller from public.cc_cartera_historica_equivalencias e
     where lower(btrim(e.seller_name_odoo)) = lower(v_odoo) limit 1;
  end if;

  if v_seller is not null then
    select coalesce(p.active, false) and p.role_id = 'pos', p.email into v_ok, v_email
      from public.profiles p where p.id = v_seller;
    if coalesce(v_ok, false) then
      return jsonb_build_object('estado', 'cartera', 'seller_profile_id', v_seller, 'seller', v_email);
    end if;
    return jsonb_build_object('estado', 'no_resoluble');   -- vendedor asignado pero inelegible: no cae al cajero
  end if;

  -- Sin vendedor resoluble: igual que CX-0c (Odoo sin equivalencia o comprador con cartera = no_resoluble).
  v_previo := case
    when v_odoo is not null then 'no_resoluble'
    when p_doctor is not null and exists (select 1 from public.cc_cartera k where k.profile_id = p_doctor) then 'no_resoluble'
    else 'sin_asignacion' end;
  return jsonb_build_object('estado', v_previo);
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
    -- IDENTIDAD (0761) · si ya hay una ficha sin cuenta con su teléfono, correo o cédula, se liga esa (no otra)
    if v_customer is null then
      v_customer := public._cliente_identidad(coalesce(nullif(p_new_customer ->> 'phone', ''), (select coalesce(nullif(meta -> 'shipping' ->> 'phone', ''), meta ->> 'phone') from public.profiles where id = p_profile)),
                                              coalesce(nullif(p_new_customer ->> 'email', ''), (select email from public.profiles where id = p_profile)),
                                              (select meta ->> 'cedula' from public.profiles where id = p_profile), true);
      if v_customer is not null then update public.customers set profile_id = p_profile, updated_at = now() where id = v_customer; end if;
    end if;
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

  -- IDENTIDAD (0761) · la vendedora que eligió Dirección queda en la CARTERA (antes solo en seller_name, que nadie lee)
  if not exists (select 1 from public.cc_cartera where profile_id = p_profile)
     and (p_new_customer -> 'meta' ->> 'seller_profile_id') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.profiles s where s.id = (p_new_customer -> 'meta' ->> 'seller_profile_id')::uuid and s.role_id = 'pos' and s.active) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (p_profile, (p_new_customer -> 'meta' ->> 'seller_profile_id')::uuid, now(), auth.uid(), 'Asignada por Dirección al aprobar');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
    values (p_profile, null, (p_new_customer -> 'meta' ->> 'seller_profile_id')::uuid, auth.uid(), 'Asignada por Dirección al aprobar');
  end if;
  perform public._cliente_adopta_registro(v_customer, p_profile);   -- lo del registro pasa a su ficha
  perform public._ligar_prerregistro(p_profile);   -- otro dispositivo: su conversación del enlace pasa a su cuenta

  -- Cierra el lazo prospect ↔ customer para conversiones (determinista: convertedDoctorId = ESTE profile).
  update public.prospects
     set customer_id = v_customer
   where customer_id is null
     and meta->>'convertedDoctorId' = p_profile::text;

  return jsonb_build_object('ok', true, 'customer_id', v_customer);
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
                                                          'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, true))));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_cartera_ranking()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_plazo int := public._cc_cartera_plazo(); v_mes timestamptz := date_trunc('month', now() at time zone 'America/Mazatlan') at time zone 'America/Mazatlan';
begin
  if v_uid is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('vendedor', public._cc_nombre_personal(v.id), 'soy_yo', v.id = v_uid,
             'en_cartera', (select count(*) from public._cc_cartera_filas() f where f.seller = v.id and now() < f.plazo_desde + make_interval(days => v_plazo)),
             'por_vencer_30', (select count(*) from public._cc_cartera_filas() f where f.seller = v.id and now() < f.plazo_desde + make_interval(days => v_plazo) and f.plazo_desde + make_interval(days => v_plazo) <= now() + interval '30 days'),
             'compraron_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'renovado' and e.created_at >= v_mes),
             'rescatados_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'renovado' and e.dias_sin_compra >= 30 and e.created_at >= v_mes),
             'nuevos_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'asignado' and e.created_at >= v_mes),
             'perdidos_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'liberado' and e.created_at >= v_mes))
           order by (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'renovado' and e.created_at >= v_mes) desc, public._cc_nombre_personal(v.id))
      from public.profiles v
     where v.role_id = 'pos' and v.active and not coalesce(v.interna, false) and coalesce(v.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones'), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_codigo_referido_crear(p_seller uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_code text; v_alfabeto text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; b bytea; i int;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección crea códigos de referido'; end if;
  if not exists (select 1 from public.profiles where id = p_seller and role_id = 'pos' and active) then
    raise exception 'VENDEDOR_INVALIDO: el código solo puede apuntar a un vendedor activo';
  end if;
  loop
    b := extensions.gen_random_bytes(8); v_code := '';
    for i in 0..7 loop v_code := v_code || substr(v_alfabeto, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.cc_referral_codes where code = v_code);
  end loop;
  insert into public.cc_referral_codes (code, seller_profile_id, created_by) values (v_code, p_seller, auth.uid());
  perform public.log_audit('Código de referido creado', v_code, null, null);
  return v_code;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_enlaces_equipo()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('seller', x.id, 'nombre', public._cc_nombre_personal(x.id), 'codigo', c, 'cifras', public._cc_enlace_cifras(c)) order by public._cc_nombre_personal(x.id))
    from (select p.id, public._cc_enlace_de_vendedor(p.id) c from public.profiles p
           where p.role_id = 'pos' and p.active and not coalesce(p.interna, false) and public._cc_vendedor_elegible(p.id, false)) x), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_equivalencia_historica_guardar(p_seller_name_odoo text, p_seller uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ant uuid; v_nombre text := btrim(p_seller_name_odoo);
begin
  perform public._cc7_direccion();
  if v_nombre is null or v_nombre = '' or length(v_nombre) > 200 then raise exception 'EQUIVALENCIA_INVALIDA: nombre de Odoo' using errcode = 'check_violation'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.customers cu where cu.seller_name = v_nombre) then
    raise exception 'EQUIVALENCIA_INVALIDA: ningún cliente tiene ese vendedor en Odoo (debe ser el texto exacto)' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles s where s.id = p_seller and s.role_id = 'pos') then
    raise exception 'EQUIVALENCIA_INVALIDA: el perfil debe ser de ventas' using errcode = 'check_violation';
  end if;
  select seller_profile_id into v_ant from public.cc_cartera_historica_equivalencias where seller_name_odoo = v_nombre for update;
  if v_ant = p_seller then return jsonb_build_object('idempotente', true); end if;
  insert into public.cc_cartera_historica_equivalencias (seller_name_odoo, seller_profile_id, autorizado_por, motivo)
  values (v_nombre, p_seller, auth.uid(), left(btrim(p_motivo), 200))
  on conflict (seller_name_odoo) do update set seller_profile_id = excluded.seller_profile_id, autorizado_por = excluded.autorizado_por, autorizado_at = now(), motivo = excluded.motivo;
  insert into public.cc_cartera_historica_eventos (accion, seller_name_odoo, seller_anterior, seller_nuevo, actor_profile_id, motivo)
  values ('equivalencia_guardada', v_nombre, v_ant, p_seller, auth.uid(), left(btrim(p_motivo), 200));
  return jsonb_build_object('idempotente', false);
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
    'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, false)),
    -- REPARTO (181)
    'reparto_activo', (select reparto_activo from public.cc_atencion_config where id = 1),
    'reparto_en_curso', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_assigned' and c.ruteo_motivo = 'reparto'),
    'vendedores_elegibles_nuevos', (select count(*) from public.profiles p where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, true)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_vendedores()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc7_direccion();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', coalesce(p.meta ->> 'name', p.full_name, p.email), 'activo', p.active,
      'conversaciones', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones',
      'nuevos_clientes', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'nuevos_clientes',
      'elegible', public._cc_vendedor_elegible(p.id, false), 'elegible_nuevos', public._cc_vendedor_elegible(p.id, true),
      'clientes', (select count(*) from public.cc_cartera k where k.seller_profile_id = p.id) + (select count(*) from public.cc_cartera_clientes kk where kk.seller_profile_id = p.id)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
    from public.profiles p where p.role_id = 'pos' and not p.interna), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_vendedores_traspaso()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or public.auth_role() not in ('pos', 'admin') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', coalesce(p.meta ->> 'name', p.full_name, p.email)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
    from public.profiles p where p.role_id = 'pos' and p.id <> auth.uid() and public._cc_vendedor_elegible(p.id, false)), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_visitante_abrir(p_hash text, p_hash_nuevo text, p_attr jsonb DEFAULT NULL::jsonb, p_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.cc_visitors%rowtype; attr jsonb := public._cc_attr_limpia(coalesce(p_attr, '{}'::jsonb));
  v_seller uuid; v_code text;
begin
  if p_hash_nuevo is null or p_hash_nuevo !~ '^[0-9a-f]{64}$' then
    raise exception 'CC1_ARGUMENTOS: hash nuevo inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_hash is not null and p_hash ~ '^[0-9a-f]{64}$' then
    select * into v from public.cc_visitors where token_hash = p_hash and estado = 'activo' for update;
    if found then
      update public.cc_visitors set
        last_seen_at = now(),
        visitas = least(visitas + 1, 1000000),
        first_touch    = case when first_touch is null and attr <> '{}'::jsonb then attr else first_touch end,
        first_touch_at = case when first_touch is null and attr <> '{}'::jsonb then now() else first_touch_at end,
        last_touch     = case when public._cc_atribuible(attr) and attr is distinct from last_touch then attr else last_touch end,
        last_touch_at  = case when public._cc_atribuible(attr) and attr is distinct from last_touch then now() else last_touch_at end
      where id = v.id;
      if public._cc_atribuible(attr) and attr is distinct from v.last_touch then
        insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (v.id, 'last_touch', attr);
      end if;
      return jsonb_build_object('visitor_id', v.id, 'nuevo', false, 'estado', 'activo');
    end if;
  end if;
  -- Sin token válido (ausente, inventado, revocado o adoptado): visitante NUEVO.
  if p_ref is not null then
    v_code := upper(left(btrim(p_ref), 8));
    select c.seller_profile_id into v_seller
      from public.cc_referral_codes c join public.profiles s on s.id = c.seller_profile_id
     where c.code = v_code and c.activo and s.active and s.role_id = 'pos';
    if v_seller is null then v_code := null; end if;
  end if;
  insert into public.cc_visitors (token_hash, first_touch, first_touch_at, last_touch, last_touch_at, referral_code, seller_profile_id)
  values (p_hash_nuevo,
          case when attr <> '{}'::jsonb then attr end, case when attr <> '{}'::jsonb then now() end,
          case when public._cc_atribuible(attr) then attr end, case when public._cc_atribuible(attr) then now() end,
          v_code, v_seller)
  returning * into v;
  insert into public.cc_visitor_events (visitor_id, tipo, detalle)
  values (v.id, 'abierto', jsonb_build_object('atribuido', public._cc_atribuible(attr), 'referido', v_seller is not null));
  return jsonb_build_object('visitor_id', v.id, 'nuevo', true, 'estado', 'activo');
end;
$function$;

CREATE OR REPLACE FUNCTION public.comisiones_equipo(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ocultos uuid[]; v_ids uuid[];
begin
  if auth.uid() is null or not public._jefe_ventas() then raise exception 'NO_AUTORIZADO: metas y comisiones son de Dirección y del jefe de ventas' using errcode = 'insufficient_privilege'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'PERIODO_INVALIDO' using errcode = 'check_violation'; end if;
  v_ocultos := coalesce((select array_agg(id) from public.profiles where interna), '{}');   -- sin excepción: tampoco para las internas
  -- pedidos levantados en el periodo (con un día de holgura por zona horaria; la pantalla corta por día del negocio)
  -- y pedidos con cobros en el periodo (un pedido anterior cobrado ahora cuenta en lo cobrado)
  select coalesce(array_agg(o.id), '{}') into v_ids from public.orders o
   where (o.created_at >= p_desde - 1 and o.created_at < p_hasta + 2
          or exists (select 1 from public.payment_entries e where e.order_id = o.id and e.value_date between p_desde and p_hasta))
     and not coalesce((o.shipping_meta ->> 'seller_profile_id')::uuid = any (v_ocultos), false);
  return jsonb_build_object(
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', coalesce(p.meta ->> 'name', p.full_name, p.email)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
                              from public.profiles p where p.role_id = 'pos' and p.active and not p.interna), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', o.id, 'status', o.status, 'created_at', o.created_at, 'total', o.total, 'external_ref', o.external_ref,
                  'shipping_meta', jsonb_strip_nulls(jsonb_build_object('seller', o.shipping_meta ->> 'seller', 'seller_profile_id', o.shipping_meta ->> 'seller_profile_id')),
                  'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.qty, 'unit_price', i.unit_price, 'linea', case when pr.line = 'prof' then 'prof' else 'cosm' end) order by i.created_at, i.id)
                                       from public.order_items i left join public.products pr on pr.id = i.product_id where i.order_id = o.id), '[]'::jsonb)) order by o.created_at)
                  from public.orders o where o.id = any (v_ids)), '[]'::jsonb),
    'asientos', coalesce((select jsonb_agg(jsonb_build_object('order_id', e.order_id, 'direction', e.direction, 'amount', e.amount, 'value_date', e.value_date) order by e.value_date, e.id)
                  from public.payment_entries e where e.order_id = any (v_ids) and e.value_date between p_desde and p_hasta), '[]'::jsonb),
    'metas', coalesce((select jsonb_agg(jsonb_build_object('seller', t.seller, 'target', t.target, 'commission_rate', t.commission_rate)) from public.sales_targets t), '[]'::jsonb),
    'puede_editar', public.auth_role() = 'admin');
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_editar(p_id uuid, p_titulo text DEFAULT NULL::text, p_monto numeric DEFAULT NULL::numeric, p_vendedor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.crm_oportunidades;
begin
  if not public._crm_puede(p_id) then raise exception 'NO_AUTORIZADO: esa oportunidad no es tuya' using errcode = 'insufficient_privilege'; end if;
  if p_vendedor is not null and not public._crm_ve_todo() then raise exception 'NO_AUTORIZADO: solo Dirección o el jefe de ventas reasignan' using errcode = 'insufficient_privilege'; end if;
  if p_vendedor is not null and not exists (select 1 from public.profiles where id = p_vendedor and role_id = 'pos' and active) then raise exception 'VENDEDOR_INVALIDO' using errcode = 'check_violation'; end if;
  update public.crm_oportunidades set titulo = coalesce(left(nullif(btrim(p_titulo), ''), 120), titulo), monto_estimado = case when p_monto is not null and p_monto >= 0 then round(p_monto, 2) else monto_estimado end,
         seller_profile_id = coalesce(p_vendedor, seller_profile_id), updated_at = now() where id = p_id returning * into o;
  return public._crm_json(o);
end;
$function$;

drop function if exists public._es_vendedor_rol(text, jsonb);
