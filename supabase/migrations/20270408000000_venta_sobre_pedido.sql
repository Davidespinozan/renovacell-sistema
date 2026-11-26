-- ============================================================================
-- VENTA SOBRE PEDIDO (26 nov 2026, dueño/Toño: «que el sistema deje vender por adelantado aunque no exista el producto
-- en almacén»; «cuando sea así no se puede facturar, se queda a la espera de recibir»).
-- Decisiones del dueño: solo productos marcados; pago con el mismo «Por confirmar»; sin límite de piezas.
--   · products.sobre_pedido: el producto se puede vender sin existencia (Levantar pedido). Punto de venta no cambia.
--   · Al crear el pedido, las piezas que no alcanzan la existencia quedan en shipping_meta.sobre_pedido
--     [{product_id, faltan}] y el pedido «espera mercancía» mientras no se surta (pagado o por pagar).
--   · cfdi_preparar no deja facturar un pedido que espera mercancía.
--   · Al registrar un lote (entrada), avisa a Almacén y Dirección qué pedidos esperaban ese producto.
-- Rollback: supabase/rollback/sobre_pedido/99_down.sql
-- ============================================================================
alter table public.products add column sobre_pedido boolean not null default false;
comment on column public.products.sobre_pedido is 'Se puede vender aunque no haya existencia (queda esperando mercancía y no se factura hasta surtir)';

create or replace view public.products_safe as
 SELECT id, sku, name, line, category, description,
        CASE WHEN ((auth_role() <> 'doctor'::text) OR is_verified()) THEN price ELSE NULL::numeric END AS price,
        unit, image_url, active, show_landing, show_portal, family, parent_product_id, sellable, junta_mayoreo, sobre_pedido
   FROM products
  WHERE (auth.uid() IS NOT NULL);

-- Existencia vendible de un producto (misma regla que product_stock: lotes no caducados, sin lo que está en custodia).
create function public._existencia_producto(p_product uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(sum(greatest(l.quantity - public.custody_held(l.id), 0)), 0)::integer
    from public.lots l where l.product_id = p_product and not public.lote_caducado(l.expiry_date);
$function$;
revoke all on function public._existencia_producto(uuid) from public, anon, authenticated;

create function public._sobre_pedido_marcar(p_order uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'faltan', x.qty - x.hay)), '[]'::jsonb) into v
    from (select i.product_id, sum(i.qty)::integer qty, public._existencia_producto(i.product_id) hay
            from public.order_items i where i.order_id = p_order and i.product_id is not null group by i.product_id) x
   where x.qty > x.hay;
  if jsonb_array_length(v) > 0 then
    perform set_config('app.trusted', 'on', true);
    update public.orders set shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('sobre_pedido', v) where id = p_order;
    perform set_config('app.trusted', '', true);
  end if;
  return v;
end;
$function$;
revoke all on function public._sobre_pedido_marcar(uuid) from public, anon, authenticated;

create function public._pedido_esperando_mercancia(p_order uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select jsonb_array_length(coalesce(o.shipping_meta -> 'sobre_pedido', '[]'::jsonb)) > 0 and o.status in ('pending_payment', 'paid')
                     from public.orders o where o.id = p_order), false);
$function$;
grant execute on function public._pedido_esperando_mercancia(uuid) to authenticated, service_role;
revoke all on function public._pedido_esperando_mercancia(uuid) from public, anon;

-- Aviso al registrar mercancía: qué pedidos esperaban ese producto.
create function public._sobre_pedido_llego()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_folios text; v_prod text;
begin
  if new.product_id is null or coalesce(new.quantity, 0) <= 0 then return new; end if;
  select string_agg(o.external_ref, ', ' order by o.created_at) into v_folios
    from public.orders o
   where o.status in ('pending_payment', 'paid') and o.shipping_meta -> 'sobre_pedido' @> jsonb_build_array(jsonb_build_object('product_id', new.product_id));
  if v_folios is not null then
    select name into v_prod from public.products where id = new.product_id;
    perform public._cc_notificar('sobre_pedido_llego', null, null, array['warehouse', 'packing', 'admin'],
      format('Llegó %s: ya se pueden surtir los pedidos sobre pedido %s', coalesce(v_prod, 'mercancía'), v_folios), 'g_pedidos', 'sobre_pedido:' || new.id::text);
  end if;
  return new;
exception when others then
  raise warning 'aviso sobre pedido no emitido: %', sqlerrm;
  return new;
end;
$function$;
create trigger trg_lots_sobre_pedido_llego after insert on public.lots for each row execute function public._sobre_pedido_llego();

CREATE OR REPLACE FUNCTION public.crear_pedido_con_entrega(p_order_id uuid, p_folio text, p_doctor_id uuid, p_lines jsonb, p_shipping_meta jsonb, p_invoice_requested boolean, p_customer_id uuid, p_receiver jsonb, p_entrega jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rol text := public.auth_role(); v_actor text; v_res jsonb; v_ent jsonb; v_cp text; o record; v_tipo text;
begin
  if not ((v_rol = 'doctor' and p_doctor_id = auth.uid() and public.is_verified()) or v_rol = any (array['admin', 'pos'])) then
    raise exception 'No autorizado';
  end if;
  v_actor := case when v_rol = 'doctor' then 'doctor' else 'staff' end;
  if p_entrega is null or jsonb_typeof(p_entrega) <> 'object' then raise exception 'ENTREGA_REQUERIDA: el pedido necesita cómo se entrega' using errcode = 'check_violation'; end if;
  -- La opción se valida con un importe provisional (0) solo para saber si exige domicilio; el costo real se calcula
  -- después con el importe que fija crear_pedido.
  v_tipo := (select x ->> 'tipo' from jsonb_array_elements(public.entrega_opciones(v_actor, 0, null, now()) -> 'opciones') x where x ->> 'id' = p_entrega ->> 'opcion');
  if v_tipo is null then raise exception 'ENTREGA_INVALIDA: opción de entrega desconocida' using errcode = 'check_violation'; end if;
  v_cp := nullif(btrim(coalesce(p_shipping_meta -> 'address' ->> 'cp', '')), '');
  if v_tipo in ('foraneo', 'local') and (public._cc_chk_direccion_snapshot(p_shipping_meta -> 'address') is null or v_cp !~ '^[0-9]{5}$') then
    raise exception 'ENTREGA_SIN_DIRECCION: ese tipo de entrega necesita calle y código postal de 5 dígitos' using errcode = 'check_violation';
  end if;

  v_res := public.crear_pedido_con_receptor(p_order_id, p_folio, p_doctor_id, p_lines, p_shipping_meta, p_invoice_requested, p_customer_id, p_receiver);
  if coalesce((v_res ->> 'idempotent')::boolean, false) then
    select shipping_cost, total, shipping_meta -> 'entrega' as entrega into o from public.orders where id = p_order_id;
    return v_res || jsonb_build_object('total', o.total, 'envio', o.shipping_cost, 'entrega', o.entrega);
  end if;
  v_ent := public._entrega_normalizar(v_actor, (v_res ->> 'total')::numeric, v_cp, p_entrega, now());
  v_ent := v_ent || public._entrega_extras(v_actor, p_lines, p_entrega -> 'extras');   -- ENVÍOS EXTRA
  perform public._entrega_aplicar(p_order_id, v_ent);
  perform public._sobre_pedido_marcar(p_order_id);   -- SOBRE PEDIDO (26 nov 2026): lo que no hay en almacén queda «esperando mercancía»
  return v_res || jsonb_build_object('subtotal', (v_res ->> 'total')::numeric, 'envio', (v_ent ->> 'flete')::numeric + coalesce((v_ent ->> 'extras_flete')::numeric, 0),
                                     'total', (v_res ->> 'total')::numeric + (v_ent ->> 'flete')::numeric + coalesce((v_ent ->> 'extras_flete')::numeric, 0), 'entrega', v_ent);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cfdi_preparar(p_doc uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.fiscal_documents; o record; cs record; env public.fiscal_concepto_envio; v_falta text[] := '{}'; v_lineas jsonb; v_cobros jsonb; v_suma numeric;
begin
  perform public._pf_autorizar();
  select * into d from public.fiscal_documents where id = p_doc;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  select x.id, x.external_ref, x.status, x.payment_status, x.total, coalesce(x.shipping_cost, 0) shipping_cost, coalesce(x.currency, 'MXN') currency into o
    from public.orders x where x.id = d.order_id;
  select razon_social, rfc, regimen_fiscal, cp into cs from public.company_settings where id = 'default';
  select * into env from public.fiscal_concepto_envio where id = 'envio';

  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'sku', p.sku, 'nombre', p.name, 'qty', i.qty, 'unit_price', i.unit_price,
           'clave_prod_serv', f.clave_prod_serv, 'clave_unidad', f.clave_unidad, 'objeto_imp', f.objeto_imp, 'tratamiento_iva', f.tratamiento_iva,
           'iva_tasa', f.iva_tasa, 'descripcion_fiscal', f.descripcion_fiscal, 'validado', coalesce(f.validado, false)) order by i.created_at, i.id), '[]'::jsonb),
         coalesce(sum(i.qty * i.unit_price), 0)
    into v_lineas, v_suma
    from public.order_items i join public.products p on p.id = i.product_id left join public.product_fiscal f on f.product_id = i.product_id
   where i.order_id = d.order_id;
  select coalesce(jsonb_agg(jsonb_build_object('method', m, 'amount', a) order by a desc), '[]'::jsonb) into v_cobros
    from (select e.method m, sum(case when e.direction = 'in' then e.amount else -e.amount end) a
            from public.payment_entries e where e.order_id = d.order_id and e.refund_id is null group by e.method) t where a > 0;

  if d.status <> 'pendiente' then v_falta := v_falta || ('La solicitud está en estado ' || d.status || '.'); end if;
  if o.status = 'cancelled' then v_falta := v_falta || 'El pedido está cancelado.'::text; end if;
  if o.payment_status <> 'paid' then v_falta := v_falta || 'El pedido debe estar pagado.'::text; end if;
  -- SOBRE PEDIDO (dueño, 26 nov 2026): no se factura hasta recibir la mercancía y surtir el pedido.
  if public._pedido_esperando_mercancia(d.order_id) then v_falta := v_falta || 'Pedido sobre pedido: se factura cuando llegue la mercancía y se surta.'::text; end if;
  if nullif(btrim(coalesce(cs.rfc, '')), '') is null or nullif(btrim(coalesce(cs.razon_social, '')), '') is null
     or nullif(btrim(coalesce(cs.regimen_fiscal, '')), '') is null or coalesce(cs.cp, '') !~ '^[0-9]{5}$' then
    v_falta := v_falta || 'Faltan datos fiscales del emisor (Configuración): RFC, razón social, régimen o CP.'::text;
  end if;
  v_falta := v_falta || coalesce((select array_agg(x.nombre || ': falta ' || array_to_string(x.faltantes, ', ') order by x.nombre) from public.pedido_fiscalmente_listo(d.order_id) x), '{}');
  if o.shipping_cost > 0 and not coalesce(env.validado, false) then
    v_falta := v_falta || 'Envío: configura y valida su clave SAT en Revisión fiscal.'::text;
  end if;
  if abs(v_suma + o.shipping_cost - o.total) > 0.005 then
    v_falta := v_falta || ('El total del pedido (' || o.total || ') no cuadra con sus renglones más el envío (' || (v_suma + o.shipping_cost) || '): revísalo antes de facturar.');
  end if;

  return jsonb_build_object('doc_id', d.id, 'status', d.status, 'receiver', d.receiver,
    'order', jsonb_build_object('id', o.id, 'folio', o.external_ref, 'status', o.status, 'payment_status', o.payment_status, 'total', o.total, 'shipping_cost', o.shipping_cost, 'currency', o.currency),
    'lineas', v_lineas,
    'envio', case when o.shipping_cost > 0 and env.id is not null then jsonb_build_object('clave_prod_serv', env.clave_prod_serv, 'clave_unidad', env.clave_unidad,
               'objeto_imp', env.objeto_imp, 'tratamiento_iva', env.tratamiento_iva, 'iva_tasa', env.iva_tasa, 'descripcion_fiscal', env.descripcion_fiscal, 'validado', env.validado) end,
    'cobros', v_cobros,
    'emisor', jsonb_build_object('rfc', upper(btrim(coalesce(cs.rfc, ''))), 'razon_social', cs.razon_social, 'regimen_fiscal', cs.regimen_fiscal, 'cp', cs.cp),
    'faltantes', to_jsonb(v_falta), 'listo', coalesce(array_length(v_falta, 1), 0) = 0);
end;
$function$;
