-- SEC-B (139) · down: restaura EXACTAMENTE registrar_cobro (md5 90a68ac2…), autorizar_reembolso (507f8823…), reportar_pago
-- (bc88599c…) y registrar_corte_caja (a6f9ecac…) de producción, sin comentario (como en producción). Permisos, dueño, políticas y
-- datos no cambian (CREATE OR REPLACE conserva el ACL).
-- ⚠️ REABRE F2: pos vuelve a registrar cobros, autorizar reembolsos y reportar pagos sobre CUALQUIER pedido, y a cerrar el corte
-- del día y el de otros cajeros; reportar_pago vuelve a resolver la idempotencia antes de autorizar y a distinguir inexistente.
do $pre$ begin
  if md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)) <> '0283a2987642a72f1fca89d6691e3c71'
     or md5(pg_get_functiondef('public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)) <> '11e7492a53d68904573e79bd41a37190'
     or md5(pg_get_functiondef('public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)) <> 'a41ef8615e80f0834c2e6b48e75d4004'
     or md5(pg_get_functiondef('public.registrar_corte_caja(uuid,date,text,numeric,numeric,text,uuid)'::regprocedure)) <> '818494eef08f5fa91ac06e649541be41' then
    raise exception 'SEC-B down: las funciones no son la versión SEC-B esperada; no se revierte sobre un estado desconocido';
  end if;
end $pre$;
CREATE OR REPLACE FUNCTION public.registrar_cobro(p_op_id uuid, p_order uuid, p_method text, p_amount numeric, p_value_date date DEFAULT NULL::date, p_reference text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_evidence text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req jsonb; v_prev jsonb; v_o record; v_entry uuid; v_estado text; v_m record; v_srv boolean;
begin
  -- service_role = webhook del proveedor (Stripe): su notificación firmada ES la evidencia.
  v_srv := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
  if not (v_srv or public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para registrar cobros';
  end if;
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount,
             'value_date', p_value_date, 'reference', p_reference, 'bank', p_bank_account_id, 'evidence', p_evidence);
  v_prev := public._w2_op_begin(p_op_id, 'cobro', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','stripe','otro') then
    raise exception 'METODO_INVALIDO';
  end if;
  if p_bank_account_id is not null and not exists (
       select 1 from public.company_bank_accounts where id = p_bank_account_id and active) then
    raise exception 'CUENTA_INVALIDA: la cuenta bancaria no existe o está inactiva';
  end if;

  -- F-9: el dinero que llegó SE REGISTRA SIEMPRE, incluso sobre un pedido cancelado.
  -- El conflicto no se niega: queda como excepción en la conciliación (D5).
  v_entry := public._w2_asiento(p_op_id, p_order, 'in', p_method, p_amount,
               coalesce(p_value_date, public.hoy_local()), null, null, p_reference, p_bank_account_id, p_evidence);
  v_estado := public._w2_recalc_payment_status(p_order);
  select * into v_m from public.v_order_money where order_id = p_order;

  return public._w2_op_finish(p_op_id, 'cobro', v_req,
    jsonb_build_object('status', 'applied', 'entry_id', v_entry, 'order_id', p_order,
                       'payment_status', v_estado, 'cobrado_neto', v_m.cobrado_neto, 'saldo', v_m.saldo,
                       'sobrepago', v_m.sobrepago, 'sobre_pedido_cancelado', (v_o.status = 'cancelled')));
end;
$function$;
CREATE OR REPLACE FUNCTION public.autorizar_reembolso(p_op_id uuid, p_order uuid, p_tipo text, p_monto numeric, p_motivo text, p_return_id uuid DEFAULT NULL::uuid, p_usuario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req jsonb; v_prev jsonb; v_o record; v_devuelto numeric; v_restante numeric; v_id uuid;
begin
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para autorizar reembolsos';
  end if;
  v_req := jsonb_build_object('order', p_order, 'tipo', p_tipo, 'monto', p_monto, 'motivo', p_motivo, 'return', p_return_id);
  v_prev := public._w2_op_begin(p_op_id, 'reembolso_autorizado', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_tipo is null or p_tipo <> all (array['devolucion','correccion','cortesia']) then
    raise exception 'TIPO_INVALIDO: usa devolucion, correccion o cortesia';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO: sin motivo no se puede auditar el reembolso';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INVALIDO: el pedido no existe'; end if;
  if v_o.status = 'draft' then raise exception 'PEDIDO_INVALIDO: no se puede reembolsar un borrador'; end if;
  if p_return_id is not null and not exists (
       select 1 from public.stock_returns sr where sr.id = p_return_id and sr.order_id = p_order) then
    raise exception 'DEVOLUCION_INVALIDA: esa devolución física no pertenece a este pedido';
  end if;

  select coalesce(sum(r.monto), 0) into v_devuelto from public.refunds r where r.order_id = p_order;
  v_restante := coalesce(v_o.total, 0) - v_devuelto;
  if p_monto > v_restante then
    raise exception 'MONTO_EXCEDE: el máximo por reembolsar de este pedido es %', v_restante;
  end if;

  insert into public.refunds (order_id, tipo, monto, motivo, metodo, usuario, created_by, items, op_id, return_id)
  values (p_order, p_tipo, p_monto, left(btrim(p_motivo), 400), v_o.payment_method,
          coalesce(nullif(btrim(p_usuario), ''), 'Sistema'), auth.uid(), null, p_op_id, p_return_id)
  returning id into v_id;

  return public._w2_op_finish(p_op_id, 'reembolso_autorizado', v_req,
    jsonb_build_object('status', 'applied', 'refund_id', v_id, 'restante', v_restante - p_monto,
                       'nota', 'Autorizado. El dinero NO ha salido hasta registrar el pago del reembolso.'));
end;
$function$;
CREATE OR REPLACE FUNCTION public.reportar_pago(p_op_id uuid, p_order uuid, p_method text, p_amount numeric, p_reference text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_proof_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_o record; v_saldo numeric;
begin
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount,
             'reference', p_reference, 'bank', p_bank_account_id, 'proof', p_proof_path);
  v_prev := public._w2_op_begin(p_op_id, 'reporte_pago', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  select m.saldo into v_saldo from public.v_order_money m where m.order_id = p_order;
  if not (v_role = any (array['admin','billing','pos']) or (v_role = 'doctor' and v_o.doctor_id = v_uid)) then
    raise exception 'NO_AUTORIZADO: no puedes reportar un pago de este pedido';
  end if;
  if v_o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado'; end if;
  if v_saldo <= 0 then raise exception 'SIN_SALDO: ese pedido no tiene saldo por cobrar'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','stripe','otro') then
    raise exception 'METODO_INVALIDO';
  end if;
  if p_bank_account_id is not null and not exists (
       select 1 from public.company_bank_accounts where id = p_bank_account_id and active) then
    raise exception 'CUENTA_INVALIDA: la cuenta bancaria no existe o está inactiva';
  end if;
  if exists (select 1 from public.payment_claims c where c.order_id = p_order and c.status = 'reportado') then
    raise exception 'DECLARACION_ABIERTA: ya hay un comprobante en revisión para este pedido';
  end if;

  insert into public.payment_claims (id, order_id, method, amount_declared, reference, bank_account_id, proof_path, declared_by)
  values (p_op_id, p_order, p_method, p_amount, nullif(btrim(p_reference), ''), p_bank_account_id,
          nullif(btrim(p_proof_path), ''), v_uid);

  return public._w2_op_finish(p_op_id, 'reporte_pago', v_req,
    jsonb_build_object('status', 'applied', 'claim_id', p_op_id, 'order_id', p_order, 'saldo', v_saldo));
end;
$function$;
CREATE OR REPLACE FUNCTION public.registrar_corte_caja(p_op_id uuid, p_fecha date, p_alcance text, p_fondo numeric, p_contado numeric, p_motivo text DEFAULT NULL::text, p_cajero uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req jsonb; v_prev jsonb; v_esperado numeric; v_dif numeric; v_id uuid := gen_random_uuid();
  v_cajero uuid; v_desde timestamptz; v_hasta timestamptz; v_cola public.cash_closings;
begin
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para cerrar caja';
  end if;
  v_req := jsonb_build_object('fecha', p_fecha, 'alcance', p_alcance, 'fondo', p_fondo, 'contado', p_contado,
             'motivo', p_motivo, 'cajero', p_cajero);
  v_prev := public._w2_op_begin(p_op_id, 'corte_caja', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_alcance not in ('dia','cajero') then raise exception 'ALCANCE_INVALIDO: usa dia o cajero'; end if;
  if p_alcance = 'cajero' and p_cajero is null then raise exception 'CAJERO_REQUERIDO'; end if;
  if p_fecha > public.hoy_local() then raise exception 'FECHA_FUTURA'; end if;
  if p_contado is null or p_contado < 0 or coalesce(p_fondo, 0) < 0 then raise exception 'MONTO_INVALIDO'; end if;
  v_cajero := case when p_alcance = 'dia' then null else p_cajero end;

  -- D-W2-CASH-CUTOFF · un solo corte a la vez por alcance: el cerrojo serializa
  -- "leer el límite vigente → reclamar el tramo siguiente". El índice único de la
  -- cadena es el respaldo duro si dos transacciones llegaran igual.
  perform pg_advisory_xact_lock(hashtext('w2_corte:' || p_alcance || ':' || coalesce(v_cajero::text, '-')));

  -- F-10 + cutoff: el tramo y el esperado los calcula el SERVIDOR. `now()` se fija una
  -- sola vez para que el esperado y el tramo guardado no puedan discrepar.
  v_hasta := clock_timestamp();
  v_cola  := public._w2_corte_cola(p_alcance, v_cajero);
  -- Cerrojo de fila sobre el límite vigente: respaldo del cerrojo de aviso de arriba.
  if v_cola.id is not null then perform 1 from public.cash_closings where id = v_cola.id for update; end if;
  v_desde := public._w2_corte_desde(p_fecha, p_alcance, v_cajero);
  if v_desde >= v_hasta then
    raise exception 'TRAMO_VACIO: el último corte de este alcance ya cubre hasta ahora';
  end if;
  v_esperado := public._w2_efectivo_tramo(v_desde, v_hasta, p_alcance, v_cajero);

  v_dif := p_contado - (v_esperado + coalesce(p_fondo, 0));
  if abs(v_dif) > 0 and nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO: hay una diferencia de %; explica por qué', v_dif;
  end if;

  perform public._w2_trusted(true);
  insert into public.cash_closings (id, fecha, alcance, esperado, fondo, contado, diferencia, motivo, usuario,
                                    created_by, op_id, cajero, corte_desde, corte_hasta, prev_closing_id)
  values (v_id, p_fecha, p_alcance, v_esperado, coalesce(p_fondo, 0), p_contado, v_dif,
          nullif(btrim(p_motivo), ''), coalesce(public.auth_role(), ''), auth.uid(), p_op_id,
          v_cajero, v_desde, v_hasta, v_cola.id);
  perform public._w2_trusted(false);

  return public._w2_op_finish(p_op_id, 'corte_caja', v_req,
    jsonb_build_object('status', 'applied', 'closing_id', v_id, 'esperado', v_esperado,
                       'contado', p_contado, 'diferencia', v_dif,
                       'desde', v_desde, 'hasta', v_hasta, 'continua_de', v_cola.id));
end;
$function$;
comment on function public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text) is null;
comment on function public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text) is null;
comment on function public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text) is null;
comment on function public.registrar_corte_caja(uuid,date,text,numeric,numeric,text,uuid) is null;
do $post$ begin
  if md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)) <> '90a68ac2874f47c4f9bdb1c9dc5e29c3'
     or md5(pg_get_functiondef('public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)) <> '507f882343f3a34383794040062e183b'
     or md5(pg_get_functiondef('public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)) <> 'bc88599cf93fdec6f8d19843c5bcef99'
     or md5(pg_get_functiondef('public.registrar_corte_caja(uuid,date,text,numeric,numeric,text,uuid)'::regprocedure)) <> 'a6f9ecaccf463945c63d092280d817c6' then
    raise exception 'SEC-B down: la restauración no es idéntica a producción';
  end if;
end $post$;
