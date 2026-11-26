drop trigger if exists trg_lots_sobre_pedido_llego on public.lots;
drop function if exists public._sobre_pedido_llego();
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
drop function if exists public._pedido_esperando_mercancia(uuid);
drop function if exists public._sobre_pedido_marcar(uuid);
drop function if exists public._existencia_producto(uuid);
drop view public.products_safe;
create view public.products_safe as
 SELECT id, sku, name, line, category, description,
        CASE WHEN ((auth_role() <> 'doctor'::text) OR is_verified()) THEN price ELSE NULL::numeric END AS price,
        unit, image_url, active, show_landing, show_portal, family, parent_product_id, sellable, junta_mayoreo
   FROM products WHERE (auth.uid() IS NOT NULL);
grant select on public.products_safe to authenticated;
grant all on public.products_safe to service_role;
alter table public.products drop column if exists sobre_pedido;
