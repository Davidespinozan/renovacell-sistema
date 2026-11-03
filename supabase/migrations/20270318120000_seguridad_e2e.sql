-- ============================================================================
-- SEGURIDAD · AUDITORÍA "COMO ATACANTE" (2 nov 2026, antes de operar). Ningún hueco para robar dinero o datos, pero:
--   P1-1 · Un doctor podía cambiar por la API la entrega de SU pedido ya cotizado (de "recoger" a "envío DHL", el servicio
--          vendido o la dirección) sin pagar el flete: Almacén enviaba lo que decía el pedido. Comprobado en el ensayo.
--          Ahora la entrega, la dirección y el servicio de un pedido solo cambian por comando del servidor.
--   P1-2 · Link de pago con tarjeta: cualquier vendedor podía poner o reemplazar el link de CUALQUIER pedido y la marca
--          "BanBajío" se engañaba con un dominio como bajio.otro.com. Ahora: Dirección/Facturación, o el vendedor del
--          cliente / del pedido (si el cliente no tiene vendedor, cualquier vendedor); un link ya enviado solo lo reemplaza
--          quien lo envió; BanBajío solo si el dominio ES del banco.
--   P1-3 · FISCAL-1 (decisiones D-F1/D-F2): Ventas corrige el receptor y solicita factura solo de SUS pedidos
--          (_sec_c1_pos_ve_pedido); Dirección y Facturación conservan sus facultades.
--   P2   · Alta de perfil directa por la API: siempre doctor sin verificar y sin capacidades, salvo Dirección o el servidor.
--   P2   · Bucket público `media`: solo imágenes (sin SVG) y hasta 10 MB.
-- ============================================================================
do $d$
declare v text;
begin
  -- P1-1 · orders_guard: el doctor no reescribe la entrega de su pedido (los comandos pasan antes por app.trusted).
  v := pg_get_functiondef('public.orders_guard()'::regprocedure);
  if position('  -- W3-A · H-3: la evidencia fiscal NO la escribe el cliente.' in v) = 0 then raise exception 'SEG_E2E: orders_guard cambió'; end if;
  execute replace(v, '  -- W3-A · H-3: la evidencia fiscal NO la escribe el cliente.', '  -- SEG-E2E · P1-1: la entrega, la dirección y el servicio de paquetería del pedido solo cambian por comando del servidor.
  IF r = ''doctor'' AND NEW.shipping_meta IS DISTINCT FROM OLD.shipping_meta THEN
    RAISE EXCEPTION ''ENTREGA_SOLO_POR_COMANDO: la entrega del pedido no se edita directamente'' USING ERRCODE = ''insufficient_privilege'';
  END IF;

  -- W3-A · H-3: la evidencia fiscal NO la escribe el cliente.');

  -- P1-3 · FISCAL-1
  v := pg_get_functiondef('public.set_order_fiscal_snapshot'::regproc);
  if position('  if v_role = any (array[''admin'',''billing'',''pos'']) then
    null;' in v) = 0 then raise exception 'SEG_E2E: set_order_fiscal_snapshot cambió'; end if;
  execute replace(v, '  if v_role = any (array[''admin'',''billing'',''pos'']) then
    null;', '  if v_role = any (array[''admin'',''billing'']) or (v_role = ''pos'' and public._sec_c1_pos_ve_pedido(p_order_id)) then   -- FISCAL-1: Ventas, solo sus pedidos
    null;');
  v := pg_get_functiondef('public.solicitar_cfdi'::regproc);
  if position('  if v_role = any (array[''admin'',''billing'',''pos'']) then null;' in v) = 0 then raise exception 'SEG_E2E: solicitar_cfdi cambió'; end if;
  execute replace(v, '  if v_role = any (array[''admin'',''billing'',''pos'']) then null;', '  if v_role = any (array[''admin'',''billing'']) or (v_role = ''pos'' and public._sec_c1_pos_ve_pedido(p_order_id)) then null;   -- FISCAL-1: Ventas, solo sus pedidos');

  -- P1-2 · link de pago
  v := pg_get_functiondef('public.link_pago_enviar(uuid,text)'::regprocedure);
  if position('  if not found or l.estado not in (''solicitado'', ''enviado'') then raise exception ''LINK_NO_ACTIVO: esa solicitud ya no está activa'' using errcode = ''check_violation''; end if;' in v) = 0
     or position('  v_bb := v_dom ~ ''(bajio|bb\.com\.mx)'';' in v) = 0 then raise exception 'SEG_E2E: link_pago_enviar cambió'; end if;
  v := replace(v, '  if not found or l.estado not in (''solicitado'', ''enviado'') then raise exception ''LINK_NO_ACTIVO: esa solicitud ya no está activa'' using errcode = ''check_violation''; end if;',
    '  if not found or l.estado not in (''solicitado'', ''enviado'') then raise exception ''LINK_NO_ACTIVO: esa solicitud ya no está activa'' using errcode = ''check_violation''; end if;
  if not public._lp_autorizado(l.order_id) then raise exception ''NO_AUTORIZADO: ese pedido es de otro vendedor'' using errcode = ''insufficient_privilege''; end if;
  if l.estado = ''enviado'' and l.enviado_por is distinct from auth.uid() and public.auth_role() = ''pos'' then
    raise exception ''LINK_YA_ENVIADO: otro vendedor ya mandó ese link; pide a Dirección que lo cancele'' using errcode = ''insufficient_privilege''; end if;');
  execute replace(v, '  v_bb := v_dom ~ ''(bajio|bb\.com\.mx)'';', '  v_bb := v_dom ~ ''(^|\.)(bb\.com\.mx|bancobajio\.com\.mx|banbajio\.com\.mx|bajionet\.com\.mx)$'';   -- el dominio ES del banco');
  v := pg_get_functiondef('public.link_pago_cancelar'::regproc);
  if position('  update public.pago_links set estado = ''cancelado''' in v) = 0 then raise exception 'SEG_E2E: link_pago_cancelar cambió'; end if;
  execute replace(v, '  update public.pago_links set estado = ''cancelado''', '  if not public._lp_autorizado((select x.order_id from public.pago_links x where x.id = p_link)) then raise exception ''NO_AUTORIZADO: ese pedido es de otro vendedor'' using errcode = ''insufficient_privilege''; end if;
  update public.pago_links set estado = ''cancelado''');
end $d$;

-- Quién puede manejar el link de pago de un pedido.
create or replace function public._lp_autorizado(p_order uuid) returns boolean
  language plpgsql stable security definer set search_path = public as
$$
declare v_cust uuid; v_seller uuid;
begin
  if public.auth_role() = any (array['admin', 'billing']) then return true; end if;
  if public.auth_role() <> 'pos' or auth.uid() is null then return false; end if;
  select customer_id into v_cust from public.orders where id = p_order;
  if public._sec_c1_pos_ve_pedido(p_order) then return true; end if;   -- su venta
  v_seller := case when v_cust is not null then public._cc_vendedor_de_cliente(v_cust) end;
  return v_seller is null or v_seller = auth.uid();   -- su cliente; sin vendedor asignado, cualquier vendedor
end;
$$;
revoke all on function public._lp_autorizado(uuid) from public, anon, authenticated;

-- P2 · alta directa de perfil por la API (no por el alta normal ni por el servidor): doctor sin verificar, sin capacidades.
-- SECURITY INVOKER a propósito: así `current_user` es el rol de quien inserta (authenticated/anon por la API).
create or replace function public._profiles_insert_guard() returns trigger
  language plpgsql security invoker set search_path = public as
$$
begin
  if current_user in ('authenticated', 'anon') and coalesce(public.auth_role(), '') <> 'admin' then
    new.role_id := 'doctor'; new.verified := false; new.price_list_id := null; new.active := true;
    new.meta := coalesce(new.meta, '{}'::jsonb) - 'capabilities';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_insert_guard on public.profiles;
create trigger profiles_insert_guard before insert on public.profiles for each row execute function public._profiles_insert_guard();

-- P2 · bucket público media: solo imágenes y hasta 10 MB (fotos de celular).
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'], file_size_limit = 10485760 where id = 'media';   -- sin SVG (puede llevar código)
