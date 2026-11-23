-- COBRO-U (23 nov 2026) · UNA SOLA FORMA DE COBRAR EN TODOS LOS PUNTOS DE VENTA, Y VENTAS TAMBIÉN COBRA.
-- Dueño: "TODOS LOS PUNTOS DE VENTA ABSOLUTAMENTE TODOS DEBEN TENER LA POSIBILIDAD DE ELEGIR TODAS LAS FORMAS
-- POSIBLES" y "VENTAS TAMBIÉN DEBE TENER LA FACULTAD DE COBRAR NO SOLO DIRECCIÓN"; "los vendedores deben tener la
-- facultad de hacer casi todo" (también el crédito). Reemplaza SEC-B D-SEC-1 ("POS cobra SOLO dentro de vender_pos").
--
-- Formas de pago (iguales en Caja, Levantar pedido, Enviar o recoger, eventos y chat):
--   efectivo | tarjeta | transferencia  → el cobro se registra en el momento (asiento en el libro)
--   credito                              → crédito con fecha límite (lo da el vendedor; Dirección recibe aviso)
--   al_recibir                           → paga al recibir (chofer o en sucursal): crédito hasta la fecha de entrega
--   link                                 → queda por cobrar con link de pago BanBajío (el vendedor lo marca pagado)
-- En mostrador ("Se lo lleva ahora") el producto solo sale con pago o crédito: link/al_recibir van por pedido.
--
-- Alcance del vendedor (rol pos): SOLO sus ventas — las mismas que ve (orders_select_scoped) más los pedidos de
-- clientes de su cartera. Cada cobro y crédito queda con su usuario (recorded_by / granted_by).

-- ── 1) ¿Puede quien llama cobrar o dar crédito sobre este pedido? ──
create or replace function public._venta_puede_cobrar(p_order uuid) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare v_role text := public.auth_role(); v_uid uuid := auth.uid(); v_mail text := auth.jwt() ->> 'email';
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then return true; end if;
  if v_role in ('admin', 'billing') then return true; end if;
  if v_role <> 'pos' or v_uid is null then return false; end if;
  return exists (
    select 1 from public.orders o
     where o.id = p_order
       and (   o.shipping_meta ->> 'seller_profile_id' = v_uid::text
            or (o.shipping_meta ->> 'seller_profile_id' is null and o.shipping_meta ->> 'seller' = v_mail)
            or o.shipping_meta ->> 'placed_by_id' = v_uid::text
            or public.order_vendor_email(o.id) = v_mail
            or public._cx0c_venta_pos_propia(o.id)
            or (o.customer_id is not null and public._cc_vendedor_de_cliente(o.customer_id) = v_uid)));
end;
$$;
alter function public._venta_puede_cobrar(uuid) owner to postgres;
revoke all on function public._venta_puede_cobrar(uuid) from public, anon, authenticated;

-- ── 2) registrar_cobro: Dirección/Facturación o el vendedor de la venta (sin cobrar de más ni sobre cancelados) ──
do $patch$
declare v text := pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure);
  a1 constant text := '  if not (v_srv or public.auth_role() = any (array[''admin'',''billing''])) then';
  a2 constant text := '  if not found then raise exception ''PEDIDO_INEXISTENTE''; end if;';
begin
  if position(a1 in v) = 0 or position(a2 in v) = 0 then raise exception 'COBRO-U: registrar_cobro cambió'; end if;
  v := replace(v, '  -- SEC-B · D-SEC-1: POS cobra SOLO dentro de vender_pos; nunca registra cobros sobre pedidos existentes.',
                  '  -- COBRO-U (23 nov 2026, dueño): Ventas también cobra, solo sus ventas (_venta_puede_cobrar).');
  v := replace(v, a1, '  if not (v_srv or public._venta_puede_cobrar(p_order)) then');
  v := replace(v, a2, a2 || '
  -- COBRO-U · el vendedor no cobra sobre cancelados ni de más (Dirección sí: F-9, el dinero que llegó se registra).
  if public.auth_role() = ''pos'' then
    if v_o.status = ''cancelled'' then raise exception ''PEDIDO_CANCELADO: ese pedido está cancelado; avisa a Dirección''; end if;
    if p_amount > coalesce((select m.saldo from public.v_order_money m where m.order_id = p_order), 0) + 0.009 then
      raise exception ''MONTO_MAYOR: el monto es mayor a lo que debe el pedido''; end if;
  end if;');
  execute v;
end $patch$;

-- ── 3) autorizar_credito: también el vendedor de la venta (máx. 180 días); Dirección recibe aviso ──
do $patch$
declare v text := pg_get_functiondef('public.autorizar_credito(uuid,uuid,date,text)'::regprocedure);
  a1 constant text := '  if public.auth_role() <> ''admin'' then
    raise exception ''NO_AUTORIZADO: solo Dirección autoriza crédito'';
  end if;';
  a2 constant text := '  values (p_op_id, p_order, p_due_date, left(btrim(p_motivo), 400), auth.uid());';
begin
  if position(a1 in v) = 0 or position(a2 in v) = 0 then raise exception 'COBRO-U: autorizar_credito cambió'; end if;
  v := replace(v, a1, '  -- COBRO-U · Dirección o el vendedor de la venta (o el sistema al crear la venta con crédito).
  if not (public.auth_role() = ''admin'' or (public.auth_role() = ''pos'' and public._venta_puede_cobrar(p_order))) then
    raise exception ''NO_AUTORIZADO: no puedes dar crédito en este pedido'';
  end if;');
  v := replace(v, '  if p_due_date < public.hoy_local() then raise exception ''VENCIMIENTO_PASADO: la fecha límite no puede ser anterior a hoy''; end if;',
                  '  if p_due_date < public.hoy_local() then raise exception ''VENCIMIENTO_PASADO: la fecha límite no puede ser anterior a hoy''; end if;
  if p_due_date > public.hoy_local() + 180 then raise exception ''VENCIMIENTO_LEJANO: el crédito es de máximo 180 días''; end if;');
  v := replace(v, a2, a2 || '
  -- COBRO-U · si no lo dio Dirección, le llega el aviso (quién, cuánto y hasta cuándo).
  if public.auth_role() <> ''admin'' then
    begin
      perform public._cc_notificar(''credito_vendedor'', null, null, array[''admin''],
        format(''Crédito dado por %s · pedido %s · %s · paga a más tardar el %s'',
               coalesce((select nullif(btrim(full_name), '''') from public.profiles where id = auth.uid()), ''un vendedor''),
               coalesce(v_o.external_ref, ''sin folio''), to_char(coalesce(v_o.total, 0), ''FM$999,999,990.00''), to_char(p_due_date, ''DD/MM/YYYY'')),
        ''av_fin'', ''credito:'' || p_op_id::text);
    exception when others then raise warning ''aviso de crédito no emitido: %'', sqlerrm;
    end;
  end if;');
  execute v;
end $patch$;

-- ── 4) link_pago_pagado: el vendedor de la venta también marca su link como pagado ──
do $patch$
declare v text := pg_get_functiondef('public.link_pago_pagado(uuid,text)'::regprocedure);
  a1 constant text := '  if not (public.auth_role() = any (array[''admin'', ''billing''])) then raise exception ''NO_AUTORIZADO: el cobro lo registran Dirección o Facturación'' using errcode = ''insufficient_privilege''; end if;';
begin
  if position(a1 in v) = 0 then raise exception 'COBRO-U: link_pago_pagado cambió'; end if;
  execute replace(v, a1, '  -- COBRO-U · también el vendedor de la venta.
  if not public._venta_puede_cobrar((select x.order_id from public.pago_links x where x.id = p_link)) then raise exception ''NO_AUTORIZADO: no puedes registrar el cobro de este link'' using errcode = ''insufficient_privilege''; end if;');
end $patch$;

-- ── 5) Aplicar la forma de pago elegida a un pedido (núcleo compartido; idempotente por p_op_id) ──
create or replace function public._venta_aplicar_cobro(p_order uuid, p_cobro jsonb, p_op_id uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare o record; m record; v_forma text; v_monto numeric; v_ref text; v_vence date; v_motivo text; v_tipo text;
  v_res jsonb; v_metodo_pedido text; v_rec numeric; v_evid text;
begin
  if p_cobro is null or jsonb_typeof(p_cobro) <> 'object' or nullif(p_cobro ->> 'forma', '') is null then
    raise exception 'FORMA_PAGO_REQUERIDA: elige cómo paga el cliente' using errcode = 'check_violation';
  end if;
  if not public._venta_puede_cobrar(p_order) then
    raise exception 'NO_AUTORIZADO: no puedes cobrar este pedido' using errcode = 'insufficient_privilege';
  end if;
  v_forma := p_cobro ->> 'forma';
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado'; end if;
  select * into m from public.v_order_money where order_id = p_order;
  v_ref := nullif(btrim(left(coalesce(p_cobro ->> 'referencia', ''), 200)), '');
  v_motivo := nullif(btrim(left(coalesce(p_cobro ->> 'motivo', ''), 300)), '');

  if v_forma in ('efectivo', 'tarjeta', 'transferencia') then
    if coalesce(m.saldo, 0) <= 0 then raise exception 'YA_PAGADO: ese pedido ya está pagado'; end if;
    v_monto := coalesce(nullif(p_cobro ->> 'monto', '')::numeric, m.saldo);
    if v_monto <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;
    if v_forma = 'transferencia' and (v_ref is null or length(v_ref) < 3) then
      raise exception 'REFERENCIA_REQUERIDA: escribe la referencia o clave de rastreo de la transferencia'; end if;
    v_rec := nullif(p_cobro ->> 'recibido', '')::numeric;
    if v_forma = 'efectivo' and v_rec is not null then
      if v_rec < v_monto then raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un cobro de %', v_rec, v_monto; end if;
      v_evid := format('recibido=%s;cambio=%s', v_rec, v_rec - v_monto);
    end if;
    v_res := public.registrar_cobro(p_op_id, p_order, v_forma, round(v_monto, 2), null, v_ref, null, v_evid);
    v_metodo_pedido := v_forma;
  elsif v_forma = 'credito' then
    v_vence := nullif(p_cobro ->> 'vence', '')::date;
    if v_vence is null then raise exception 'VENCIMIENTO_REQUERIDO: indica la fecha límite de pago'; end if;
    v_res := public.autorizar_credito(p_op_id, p_order, v_vence, coalesce(v_motivo, 'Crédito'));
    v_metodo_pedido := 'credito';
  elsif v_forma = 'al_recibir' then
    v_tipo := o.shipping_meta -> 'entrega' ->> 'tipo';
    if v_tipo is null or v_tipo not in ('local', 'recoge') then
      raise exception 'AL_RECIBIR_SOLO_LOCAL: pagar al recibir es para entrega con chofer o para recoger en sucursal; la paquetería no cobra'; end if;
    v_vence := greatest(public.hoy_local(), coalesce(nullif(o.shipping_meta -> 'entrega' ->> 'llega_hasta', '')::date, public.hoy_local()));
    v_res := public.autorizar_credito(p_op_id, p_order, v_vence,
               case when v_tipo = 'local' then 'Paga al recibir (cobra el chofer)' else 'Paga al recoger en sucursal' end);
    v_metodo_pedido := 'contra_entrega';
  elsif v_forma = 'link' then
    v_res := jsonb_build_object('status', 'pendiente', 'forma', 'link');
    v_metodo_pedido := 'link_tarjeta';
  else
    raise exception 'FORMA_PAGO_INVALIDA: %', v_forma using errcode = 'check_violation';
  end if;

  -- La forma elegida queda en el pedido (el estado de pago lo recalcula el libro, no esto).
  perform set_config('app.trusted', 'on', true);
  update public.orders set payment_method = v_metodo_pedido where id = p_order and payment_method is distinct from v_metodo_pedido;
  perform set_config('app.trusted', '', true);
  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('forma', v_forma, 'payment_method', v_metodo_pedido,
           'liberado', public.pedido_liberado_para_surtir(p_order));
end;
$$;
alter function public._venta_aplicar_cobro(uuid, jsonb, uuid) owner to postgres;
revoke all on function public._venta_aplicar_cobro(uuid, jsonb, uuid) from public, anon, authenticated;

-- ── 6) Cobrar un pedido que ya existe (chat, lista de pedidos, links): mismas formas, mismo núcleo ──
create or replace function public.cobrar_venta(p_op_id uuid, p_order uuid, p_cobro jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if p_op_id is null then raise exception 'OP_REQUERIDA' using errcode = 'check_violation'; end if;
  perform 1 from public.orders where id = p_order for update;
  return public._venta_aplicar_cobro(p_order, p_cobro, p_op_id);
end;
$$;
alter function public.cobrar_venta(uuid, uuid, jsonb) owner to postgres;
revoke all on function public.cobrar_venta(uuid, uuid, jsonb) from public, anon;
grant execute on function public.cobrar_venta(uuid, uuid, jsonb) to authenticated;

-- ── 7) Levantar pedido / Enviar o recoger: pedido + entrega + cobro en UNA transacción ──
create or replace function public.crear_pedido_con_entrega_y_cobro(p_order_id uuid, p_folio text, p_doctor_id uuid, p_lines jsonb,
  p_shipping_meta jsonb, p_invoice_requested boolean, p_customer_id uuid, p_receiver jsonb, p_entrega jsonb, p_cobro jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v jsonb; c jsonb;
begin
  v := public.crear_pedido_con_entrega(p_order_id, p_folio, p_doctor_id, p_lines, p_shipping_meta, p_invoice_requested, p_customer_id, p_receiver, p_entrega);
  -- op del cobro derivado del pedido: reintentar la misma venta no cobra dos veces.
  c := public._venta_aplicar_cobro(p_order_id, p_cobro, md5(p_order_id::text || ':cobro')::uuid);
  return coalesce(v, '{}'::jsonb) || jsonb_build_object('cobro', c);
end;
$$;
alter function public.crear_pedido_con_entrega_y_cobro(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.crear_pedido_con_entrega_y_cobro(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.crear_pedido_con_entrega_y_cobro(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb, jsonb) to authenticated;

-- ── 8) Caja (vender_pos): transferencia con referencia y CRÉDITO en mostrador ──
-- Datos de cobro en p_shipping_meta.cobro = {referencia, vence, motivo} (sin cambiar la firma que usan Caja y eventos).
do $patch$
declare v text := pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure);
  a_decl constant text := '  v_inv jsonb;';
  a_met  constant text := '  v_metodo := case when p_payment_method in (''efectivo'',''tarjeta'',''transferencia'',''stripe'') then p_payment_method else ''otro'' end;';
  a_meta constant text := '  v_meta := p_shipping_meta - ''customer'' - ''seller'' - ''seller_profile_id'' - ''seller_origen'' - ''placed_by'';';
  a_ins  constant text := '''delivered'', p_payment_method, ''paid'',';
  a_as   constant text := '  perform public._w2_asiento(gen_random_uuid(), p_order_id, ''in'', v_metodo, tot, public.hoy_local(),
    null, null, null, null,';
  a_fin  constant text := 'p_efectivo_recibido - tot) end);';
begin
  if position(a_decl in v) = 0 or position(a_met in v) = 0 or position(a_meta in v) = 0 or position(a_ins in v) = 0
     or position(a_as in v) = 0 or position(a_fin in v) = 0 then raise exception 'COBRO-U: vender_pos cambió'; end if;
  if position('v_cred_vence' in v) > 0 then raise exception 'COBRO-U: vender_pos ya trae crédito'; end if;
  v := replace(v, a_decl, a_decl || '
  v_cred_vence date; v_cred_motivo text; v_cobro_ref text;   -- COBRO-U');
  v := replace(v, a_met, '  v_metodo := case when p_payment_method in (''efectivo'',''tarjeta'',''transferencia'',''stripe'',''credito'') then p_payment_method else ''otro'' end;
  -- COBRO-U · transferencia con su referencia; crédito con fecha límite (el producto sale y queda por cobrar).
  v_cobro_ref := nullif(btrim(left(coalesce(p_shipping_meta -> ''cobro'' ->> ''referencia'', ''''), 200)), '''');
  if v_metodo = ''transferencia'' and (v_cobro_ref is null or length(v_cobro_ref) < 3) then
    raise exception ''REFERENCIA_REQUERIDA: escribe la referencia o clave de rastreo de la transferencia''; end if;
  if v_metodo = ''credito'' then
    v_cred_vence := nullif(p_shipping_meta -> ''cobro'' ->> ''vence'', '''')::date;
    if v_cred_vence is null then raise exception ''VENCIMIENTO_REQUERIDO: indica la fecha límite de pago''; end if;
    if v_cred_vence < public.hoy_local() then raise exception ''VENCIMIENTO_PASADO: la fecha límite no puede ser anterior a hoy''; end if;
    if v_cred_vence > public.hoy_local() + 180 then raise exception ''VENCIMIENTO_LEJANO: el crédito es de máximo 180 días''; end if;
    v_cred_motivo := coalesce(nullif(btrim(left(coalesce(p_shipping_meta -> ''cobro'' ->> ''motivo'', ''''), 300)), ''''), ''Crédito en mostrador'');
  end if;');
  v := replace(v, a_meta, a_meta || '
  v_meta := v_meta - ''cobro'';   -- COBRO-U · los datos del cobro van al libro, no al pedido');
  v := replace(v, a_ins, '''delivered'', p_payment_method, case when v_metodo = ''credito'' then ''pending'' else ''paid'' end,');
  v := replace(v, a_as, '  if v_metodo = ''credito'' then
    -- COBRO-U · venta a crédito: sin asiento; el crédito queda en el libro de créditos y Dirección recibe aviso.
    insert into public.credit_grants (id, order_id, due_date, reason, granted_by)
    values (md5(p_order_id::text || '':credito'')::uuid, p_order_id, v_cred_vence, v_cred_motivo, v_uid);
    begin
      perform public._cc_notificar(''credito_vendedor'', null, null, array[''admin''],
        format(''Crédito en mostrador por %s · venta %s · %s · paga a más tardar el %s'',
               coalesce((select nullif(btrim(full_name), '''') from public.profiles where id = v_uid), ''un vendedor''),
               coalesce(p_folio, ''sin folio''), to_char(tot, ''FM$999,999,990.00''), to_char(v_cred_vence, ''DD/MM/YYYY'')),
        ''av_fin'', ''credito:'' || p_order_id::text);
    exception when others then raise warning ''aviso de crédito no emitido: %'', sqlerrm;
    end;
  else
  perform public._w2_asiento(gen_random_uuid(), p_order_id, ''in'', v_metodo, tot, public.hoy_local(),
    null, null, v_cobro_ref, null,');
  v := replace(v, a_fin, a_fin || '
  end if;');
  execute v;
end $patch$;

-- ── 9) Aviso de pedido nuevo: dice si va con crédito o con link (no "por cobrar" a secas) ──
do $patch$
declare v text := pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure);
  a1 constant text := '  v_txt := format(''Nuevo pedido %s · %s · por cobrar'', coalesce(new.external_ref, ''sin folio''), to_char(coalesce(new.total, 0), ''FM$999,999,990.00''));';
begin
  if position(a1 in v) = 0 then raise exception 'COBRO-U: _aviso_pedido_nuevo cambió'; end if;
  execute replace(v, a1, '  v_txt := format(''Nuevo pedido %s · %s · %s'', coalesce(new.external_ref, ''sin folio''), to_char(coalesce(new.total, 0), ''FM$999,999,990.00''),
    case when new.payment_method = ''contra_entrega'' then ''paga al recibir''
         when new.payment_method = ''credito'' then ''con crédito''
         when new.payment_method = ''link_tarjeta'' then ''por cobrar con link de pago''
         else ''por cobrar'' end);   -- COBRO-U');
end $patch$;
