-- CARTERA-CLIENTES · rollback de la migración 152. Aplicar en UNA transacción.
-- OJO: las asignaciones de vendedor a clientes SIN cuenta se pierden (la versión anterior no tenía dónde guardarlas).
do $pre$ begin
  if to_regclass('public.cc_cartera_clientes') is null then raise exception 'CARTERA-CLIENTES rollback: la migración no está aplicada'; end if;
  if md5(pg_get_functiondef('public._c360_actor(uuid)'::regprocedure)) <> 'bdcda21e5d358f7205bdb887e75960a0'
     or md5(pg_get_functiondef('public.cc_mi_cartera()'::regprocedure)) <> '24017e47538017c2116179d56bdd0815'
     or md5(pg_get_functiondef('public.cliente_360(uuid)'::regprocedure)) <> '0050d3e89737420944be4cce476f58b6'
     or md5(pg_get_functiondef('public.cc_vendedores()'::regprocedure)) <> '19707b8e217d3f33e737ccefa2d45c8e'
     or md5(pg_get_functiondef('public._cc_prerregistro_coincidencia(text,text)'::regprocedure)) <> 'adfdd8923b39826df30e56ff3ed8be11' then
    raise exception 'CARTERA-CLIENTES rollback: las funciones no son las de la migración 152';
  end if;
end $pre$;

CREATE OR REPLACE FUNCTION public._c360_actor(p_customer uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rol text := public.auth_role(); v_profile uuid;
begin
  if public._cc_es_service() then return 'servicio'; end if;
  if v_rol = 'admin' then return 'direccion'; end if;
  select profile_id into v_profile from public.customers where id = p_customer;
  if not found then return null; end if;
  if v_rol = 'billing' then return 'facturacion'; end if;
  if v_rol = 'pos' and v_profile is not null
     and exists (select 1 from public.cc_cartera k where k.profile_id = v_profile and k.seller_profile_id = auth.uid()) then return 'vendedor'; end if;
  if v_rol = 'doctor' and v_profile is not null and v_profile = auth.uid() then return 'dueno'; end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_mi_cartera()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_seller uuid := public._cc_vendedor_consulta();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
            'profile_id', k.profile_id,
            'customer_id', (select cu.id from public.customers cu where cu.profile_id = k.profile_id order by cu.active desc, cu.created_at limit 1),
            'nombre', coalesce(p.full_name, p.meta ->> 'name', p.email),
            'asignado_at', k.asignado_at) order by coalesce(p.full_name, p.meta ->> 'name', p.email))
          from public.cc_cartera k join public.profiles p on p.id = k.profile_id
         where k.seller_profile_id = v_seller), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_360(p_customer uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c uuid := public._c360_cliente(p_customer); a text; c record; p record; k record; v record; conv record; cart record; r jsonb; v_ids uuid[];
  completo boolean; comercial boolean; vend boolean;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_actor(v_c);
  if a is null then raise exception 'NO_AUTORIZADO: no puedes ver este cliente' using errcode = 'insufficient_privilege'; end if;
  completo := a in ('direccion', 'servicio'); vend := a = 'vendedor'; comercial := completo or vend;
  select * into c from public.customers where id = v_c;
  select * into p from public.profiles where id = c.profile_id;
  select k2.seller_profile_id, k2.asignado_at, coalesce(s.meta ->> 'name', s.full_name, s.email) as nombre, public._cc_vendedor_elegible(k2.seller_profile_id, false) as elegible
    into k from public.cc_cartera k2 left join public.profiles s on s.id = k2.seller_profile_id where k2.profile_id = c.profile_id;
  select array_agg(o.id) into v_ids from public.orders o where o.customer_id = v_c;

  r := jsonb_build_object('customer_id', v_c, 'rol', a, 'permisos', jsonb_build_object(
          'contacto', case a when 'direccion' then '["full_name","email","city","country"]'::jsonb when 'servicio' then '["full_name","email","city","country"]'::jsonb
                             when 'vendedor' then '["email","city","country"]'::jsonb when 'dueno' then '["city","country"]'::jsonb else '[]'::jsonb end,
          'telefonos', a in ('direccion', 'vendedor', 'dueno', 'servicio'), 'domicilios', a in ('direccion', 'vendedor', 'dueno', 'servicio'),
          'fiscal', a in ('direccion', 'facturacion', 'dueno', 'servicio'), 'notas', a in ('direccion', 'vendedor', 'servicio'), 'cartera', completo,
          'adoptar_alta', a in ('direccion', 'dueno', 'servicio')));

  -- RESUMEN / CONTACTO
  r := r || jsonb_build_object('resumen', jsonb_build_object(
          'nombre', c.full_name, 'activo', c.active, 'creado_at', c.created_at, 'origen', c.source,
          'portal', jsonb_build_object('tiene', c.profile_id is not null, 'verificado', coalesce(p.verified, false), 'activo', coalesce(p.active, false), 'profile_id', case when completo then c.profile_id end),
          'vendedor', case when k.seller_profile_id is null then null else jsonb_build_object('id', case when comercial then k.seller_profile_id end, 'nombre', k.nombre, 'desde', k.asignado_at, 'elegible', k.elegible) end,
          'vendedor_historico', case when completo then c.seller_name end),
       'contacto', jsonb_build_object('email', c.email, 'ciudad', c.city, 'pais', c.country, 'email_portal', case when completo then p.email end,
          'telefonos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'numero', t.numero, 'etiqueta', t.etiqueta, 'es_principal', t.es_principal, 'origen', t.origen) order by t.es_principal desc, t.created_at)
                                 from public.customer_phones t where t.customer_id = v_c and t.activo), '[]'::jsonb),
          'alta', case when p.id is not null and p.meta ? 'shipping' then jsonb_build_object('telefono', p.meta -> 'shipping' ->> 'phone', 'ciudad', p.meta -> 'shipping' ->> 'city') end,
          'notas', case when comercial then coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'texto', n.texto, 'autor_rol', n.autor_rol, 'autor', coalesce(ap.meta ->> 'name', ap.full_name), 'at', n.created_at) order by n.created_at desc)
                                 from (select * from public.customer_notes where customer_id = v_c order by created_at desc limit 50) n left join public.profiles ap on ap.id = n.autor_profile_id), '[]'::jsonb) end,
          'nota_legada', case when comercial then nullif(c.meta ->> 'notes', '') end));

  -- DOMICILIOS (canónicos + alta legacy si no se ha adoptado)
  r := r || jsonb_build_object('domicilios', jsonb_build_object(
          'lista', coalesce((select jsonb_agg(to_jsonb(l) - 'doctor_id' - 'customer_id' order by l.is_default desc, l.created_at) from public.doctor_locations l
                             where l.active and (l.customer_id = v_c or (c.profile_id is not null and l.doctor_id = c.profile_id))), '[]'::jsonb),
          'archivados', (select count(*) from public.doctor_locations l where not l.active and (l.customer_id = v_c or (c.profile_id is not null and l.doctor_id = c.profile_id))),
          'alta', case when p.id is not null and jsonb_typeof(p.meta -> 'shipping') = 'object' then (p.meta -> 'shipping') - 'phone' end));

  -- FACTURACIÓN (vendedor: enmascarado; nadie más fuera de los roles)
  r := r || jsonb_build_object('facturacion', (public.cliente_perfiles_fiscales(v_c)) -> 'perfiles');

  -- PROFESIONAL / VERIFICACIÓN (solo Dirección; sin evidencia biométrica)
  if completo and p.id is not null then
    r := r || jsonb_build_object('profesional', jsonb_build_object('cedula', p.meta ->> 'cedula', 'organizacion', coalesce(p.organization, c.meta ->> 'organization'), 'especialidad', p.meta ->> 'specialty',
            'verificado', p.verified, 'verification', p.meta -> 'verification', 'sep', (p.meta -> 'verifyResult') - 'raw' - 'payload',
            'identidad', case when jsonb_typeof(p.meta -> 'identity') = 'object' then jsonb_build_object('status', p.meta -> 'identity' ->> 'status', 'live', p.meta -> 'identity' -> 'live', 'ineValid', p.meta -> 'identity' -> 'ineValid', 'faceMatch', p.meta -> 'identity' -> 'faceMatch', 'provider', p.meta -> 'identity' ->> 'provider', 'unavailable', p.meta -> 'identity' -> 'unavailable') end,
            'ultimo_acceso', (select to_jsonb(u) ->> 'last_sign_in_at' from auth.users u where u.id = p.id)));
  end if;

  -- COMERCIAL (CC-7: cartera canónica; atribución aparte; conversación y carrito)
  if comercial then
    select cv.id, cv.modo, cv.estado, cv.last_message_at, cv.handoff_origen, cv.ruteo_motivo, (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = cv.seller_profile_id) as asesor
      into conv from public.cc_conversations cv where cv.profile_id = c.profile_id and c.profile_id is not null order by (cv.estado = 'abierta') desc, cv.last_message_at desc nulls last limit 1;
    select kk.id, kk.handoff_estado, (select count(*) from public.cc_cart_items i where i.cart_id = kk.id) as n_items into cart from public.cc_carts kk where kk.profile_id = c.profile_id and kk.estado = 'active' and c.profile_id is not null;
    r := r || jsonb_build_object('comercial', jsonb_build_object(
          'historial', case when completo then coalesce((select jsonb_agg(jsonb_build_object('anterior', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = h.seller_anterior),
                                   'nuevo', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = h.seller_nuevo), 'motivo', h.motivo, 'at', h.created_at) order by h.created_at desc)
                                   from public.cc_cartera_historial h where h.profile_id = c.profile_id), '[]'::jsonb) end,
          'atribucion', jsonb_build_object('origen', c.source,
              'referido', (select jsonb_build_object('vendedor', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = vi.seller_profile_id), 'primer_contacto', vi.first_touch, 'at', vi.first_touch_at)
                             from public.cc_visitors vi where vi.adopted_profile_id = c.profile_id and c.profile_id is not null order by vi.adopted_at desc limit 1),
              'prospecto', (select jsonb_build_object('fuente', pr.source, 'estado', pr.status, 'at', pr.created_at) from public.prospects pr where pr.customer_id = v_c order by pr.created_at desc limit 1)),
          'conversacion', case when conv.id is null then null else jsonb_build_object('id', conv.id, 'modo', conv.modo, 'estado', conv.estado, 'ultimo_mensaje_at', conv.last_message_at, 'origen', conv.handoff_origen, 'ruteo_motivo', conv.ruteo_motivo, 'asesor', conv.asesor) end,
          'carrito', case when cart.id is null then null else jsonb_build_object('id', cart.id, 'n_items', cart.n_items, 'handoff', cart.handoff_estado) end));
  end if;

  -- PEDIDOS (por customer_id) + PAGOS (verdad W2) + FACTURAS (verdad W3)
  r := r || jsonb_build_object('pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'folio', o.external_ref, 'fecha', o.created_at, 'estado', o.status, 'total', o.total,
              'estado_pago', m.estado_pago, 'cobrado', case when a <> 'vendedor' then m.cobrado_neto end, 'saldo', m.saldo, 'factura_solicitada', o.invoice_requested) order by o.created_at desc)
            from (select * from public.orders where customer_id = v_c order by created_at desc limit 100) o left join public.v_order_money m on m.order_id = o.id), '[]'::jsonb),
       'resumen_pedidos', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(o.total), 0), 'ultimo', max(o.created_at)) from public.orders o where o.customer_id = v_c and coalesce(o.status, '') not in ('cancelled', 'canceled', 'cancelado')));
  if a <> 'vendedor' then
    r := r || jsonb_build_object('pagos', coalesce((select jsonb_agg(jsonb_build_object('pedido', o.external_ref, 'fecha', e.value_date, 'direccion', e.direction, 'metodo', e.method, 'monto', e.amount, 'moneda', e.currency) order by e.created_at desc)
              from (select * from public.payment_entries where order_id = any (coalesce(v_ids, '{}')) order by created_at desc limit 100) e join public.orders o on o.id = e.order_id), '[]'::jsonb),
         'pagos_reportados', coalesce((select jsonb_agg(jsonb_build_object('pedido', o.external_ref, 'fecha', pc.declared_at, 'metodo', pc.method, 'monto', pc.amount_declared, 'estado', pc.status) order by pc.created_at desc)
              from (select * from public.payment_claims where order_id = any (coalesce(v_ids, '{}')) order by created_at desc limit 50) pc join public.orders o on o.id = pc.order_id), '[]'::jsonb));
  end if;
  r := r || jsonb_build_object('facturas', coalesce((select jsonb_agg(jsonb_build_object('pedido', o.external_ref, 'tipo', f.kind, 'estado', f.status, 'uuid', f.uuid, 'serie', f.serie, 'folio', f.folio, 'total', f.total,
              'fecha', coalesce(f.provider_stamped_at, f.created_at), 'receptor_rfc', case when a <> 'vendedor' then f.receiver ->> 'rfc' end) order by f.created_at desc)
            from (select * from public.fiscal_documents where order_id = any (coalesce(v_ids, '{}')) order by created_at desc limit 100) f join public.orders o on o.id = f.order_id), '[]'::jsonb));

  -- ACTIVIDAD (eventos reales; sin valores personales ni telemetría de seguridad)
  if a in ('direccion', 'servicio', 'vendedor') then
    r := r || jsonb_build_object('actividad', coalesce((select jsonb_agg(s.x order by s.at desc) from (
        select e.created_at as at, jsonb_build_object('at', e.created_at, 'tipo', e.tipo, 'actor_rol', e.actor_rol, 'actor', coalesce(ap.meta ->> 'name', ap.full_name)) as x
          from public.customer_events e left join public.profiles ap on ap.id = e.actor_profile_id
         where e.customer_id = v_c and (a <> 'vendedor' or e.tipo not like 'fiscal%')
        union all
        select h.created_at, jsonb_build_object('at', h.created_at, 'tipo', 'cartera_' || case when h.seller_nuevo is null then 'retirada' when h.seller_anterior is null then 'asignada' else 'reasignada' end, 'actor_rol', 'direccion', 'actor', null)
          from public.cc_cartera_historial h where h.profile_id = c.profile_id and c.profile_id is not null and a <> 'vendedor'
        union all
        select o.created_at, jsonb_build_object('at', o.created_at, 'tipo', 'pedido_creado', 'actor_rol', null, 'actor', o.external_ref) from public.orders o where o.customer_id = v_c
        order by 1 desc limit 60) s), '[]'::jsonb));
  end if;
  return r;
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
      'clientes', (select count(*) from public.cc_cartera k where k.seller_profile_id = p.id)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
    from public.profiles p where p.role_id = 'pos'), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_prerregistro_coincidencia(p_email text, p_telefono text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- ¿El correo o el celular coinciden con un cliente conocido? Solo se afirma cuando NO hay ambigüedad: un único
-- cliente y un único vendedor elegible (cartera canónica o equivalencia histórica). Con dudas, decide Dirección.
declare v_cust uuid[]; v_prof uuid[]; v_sell uuid[];
begin
  select array_agg(distinct cu.id) into v_cust from public.customers cu
   where cu.active and ((cu.email is not null and lower(btrim(cu.email)) = p_email) or public.norm_telefono_mx(cu.phone) = p_telefono);
  select array_agg(distinct x.id) into v_prof from (
    select cu.profile_id as id from public.customers cu where cu.id = any (coalesce(v_cust, '{}')) and cu.profile_id is not null
    union
    select p.id from public.profiles p where p.role_id = 'doctor' and p.active and p.email is not null and lower(btrim(p.email)) = p_email) x;
  select array_agg(distinct y.s) into v_sell from (
    select public._cc_vendedor_de(pid) as s from unnest(coalesce(v_prof, '{}')) pid
    union
    select e.seller_profile_id from public.customers cu
      join public.cc_cartera_historica_equivalencias e on e.seller_name_odoo = cu.seller_name
     where cu.id = any (coalesce(v_cust, '{}'))) y
   where y.s is not null and public._cc_vendedor_elegible(y.s, false);
  return jsonb_build_object(
    'customer', case when cardinality(v_cust) = 1 then v_cust[1] end,
    'profile',  case when cardinality(v_prof) = 1 then v_prof[1] end,
    'seller',   case when cardinality(v_sell) = 1 then v_sell[1] end);
end;
$function$;

drop trigger trg_customers_cartera_al_ligar on public.customers;
drop function public._cartera_cliente_al_ligar();
drop function public.cliente_estado_guardar(uuid, boolean, text);
drop function public.cliente_vendedor_asignar(uuid, uuid, text);
drop table public.cc_cartera_clientes_historial;
drop table public.cc_cartera_clientes;
-- La actividad es historia: sus filas nuevas se conservan y la restricción anterior se repone sin revalidarlas.
alter table public.customer_events drop constraint ck_ce_tipo;
alter table public.customer_events add constraint ck_ce_tipo check (tipo = any (array['contacto_actualizado', 'telefono_agregado', 'telefono_actualizado', 'telefono_principal', 'telefono_archivado', 'domicilio_agregado', 'domicilio_actualizado', 'domicilio_predeterminado', 'domicilio_archivado', 'domicilio_adoptado_alta', 'fiscal_agregado', 'fiscal_actualizado', 'fiscal_predeterminado', 'fiscal_archivado', 'nota_agregada', 'migracion'])) not valid;

do $post$ begin
  if md5(pg_get_functiondef('public._c360_actor(uuid)'::regprocedure)) <> '4952be3c8cc4c75ba0bc2fe0e914db70'
     or md5(pg_get_functiondef('public.cc_mi_cartera()'::regprocedure)) <> 'a02c498626e4454e236f4b6633502a41'
     or md5(pg_get_functiondef('public.cliente_360(uuid)'::regprocedure)) <> '4d09fcfda9cbe2ac5cc261eb9871c53a'
     or md5(pg_get_functiondef('public.cc_vendedores()'::regprocedure)) <> 'cf9f22c438205f05d07ed450dd8ee009'
     or md5(pg_get_functiondef('public._cc_prerregistro_coincidencia(text,text)'::regprocedure)) <> '0bcee140991db42178db2b6e6547371a' then
    raise exception 'CARTERA-CLIENTES rollback: las funciones no volvieron a su versión anterior';
  end if;
end $post$;
