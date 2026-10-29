-- PEDIDOS-PREVIOS (20270207) · down: políticas, order_owner, estado_dinero_pedido y reportar_pago a su definición exacta anterior.
drop policy credit_grants_select_ops on public.credit_grants;
create policy credit_grants_select_ops on public.credit_grants for select to authenticated using (((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'warehouse'::text, 'packing'::text])) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = credit_grants.order_id) AND (o.doctor_id = auth.uid()))))));
drop policy order_cancellations_select_ops on public.order_cancellations;
create policy order_cancellations_select_ops on public.order_cancellations for select to authenticated using (((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'billing'::text])) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_cancellations.order_id) AND (o.doctor_id = auth.uid()))))));
drop policy order_items_select_scoped on public.order_items;
create policy order_items_select_scoped on public.order_items for select to authenticated using (((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'billing'::text])) OR ((auth_role() = 'pos'::text) AND _sec_c1_ve_pedido(order_id)) OR ((auth_role() = 'driver'::text) AND is_order_driver(order_id)) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.doctor_id = auth.uid()))))));
drop policy orders_select_scoped on public.orders;
create policy orders_select_scoped on public.orders for select to authenticated using (((auth_role() = 'admin'::text) OR (doctor_id = auth.uid()) OR (auth_role() = ANY (ARRAY['warehouse'::text, 'packing'::text, 'billing'::text])) OR ((auth_role() = 'pos'::text) AND (((shipping_meta ->> 'seller_profile_id'::text) = (auth.uid())::text) OR (((shipping_meta ->> 'seller_profile_id'::text) IS NULL) AND ((shipping_meta ->> 'seller'::text) = (auth.jwt() ->> 'email'::text))) OR (order_vendor_email(id) = (auth.jwt() ->> 'email'::text)) OR _cx0c_venta_pos_propia(id))) OR ((auth_role() = 'driver'::text) AND is_order_driver(id))));
drop policy payment_claims_select_scoped on public.payment_claims;
create policy payment_claims_select_scoped on public.payment_claims for select to authenticated using (((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text])) OR ((auth_role() = 'pos'::text) AND _sec_c1_ve_pedido(order_id)) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = payment_claims.order_id) AND (o.doctor_id = auth.uid()))))));
CREATE OR REPLACE FUNCTION public.order_owner(o_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select o.doctor_id from public.orders o where o.id = o_id and o.doctor_id = auth.uid() $function$;
CREATE OR REPLACE FUNCTION public.estado_dinero_pedido(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m record; v_o record; v_existe boolean; v_global boolean := public.auth_role() = any (array['admin','billing','warehouse','packing']);
begin
  select * into v_o from public.orders where id = p_order;
  v_existe := found;
  -- SEC-C1: POS solo ve el estado de un pedido que puede VER (misma regla que orders_select_scoped, vía
  -- _sec_c1_pos_ve_pedido); quien no tiene visibilidad global recibe el MISMO error para ajeno e inexistente.
  if not v_existe and v_global then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if not v_existe or not (v_global
          or (public.auth_role() = 'pos' and public._sec_c1_pos_ve_pedido(p_order))
          or coalesce(v_o.doctor_id = auth.uid(), false)) then      -- NULL-safe: pedido de mostrador sin doctor
    raise exception 'NO_AUTORIZADO';
  end if;
  select * into v_m from public.v_order_money where order_id = p_order;
  return to_jsonb(v_m) || jsonb_build_object(
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'method', c.method,
                                'monto', c.amount_declared, 'declarado', c.declared_at, 'motivo_rechazo', c.reject_reason)
                          order by c.declared_at desc) from public.payment_claims c where c.order_id = p_order), '[]'::jsonb),
    'asientos', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'direction', e.direction, 'method', e.method,
                                'monto', e.amount, 'fecha_valor', e.value_date, 'reversa_de', e.reversal_of)
                          order by e.created_at) from public.payment_entries e where e.order_id = p_order), '[]'::jsonb));
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
  -- SEC-B · D-SECB-1: reportan Dirección, Facturación y el doctor SOBRE SU PROPIO pedido (POS/vendedor no, ni de su cartera).
  -- Rol Y pertenencia se autorizan ANTES de la idempotencia: un op_id repetido por quien no tiene derecho no devuelve el
  -- resultado guardado (saldo), y pedido ajeno e inexistente responden lo mismo (no se revela si existe).
  if not (v_role = any (array['admin','billing'])
          or (v_role = 'doctor' and v_uid is not null
              and exists (select 1 from public.orders o where o.id = p_order and o.doctor_id = v_uid))) then
    raise exception 'NO_AUTORIZADO: no puedes reportar un pago de este pedido';
  end if;
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount,
             'reference', p_reference, 'bank', p_bank_account_id, 'proof', p_proof_path);
  v_prev := public._w2_op_begin(p_op_id, 'reporte_pago', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  select m.saldo into v_saldo from public.v_order_money m where m.order_id = p_order;
  -- Re-chequeo bajo el bloqueo del pedido (doctor_id es inmutable por CX-0b; defensa en profundidad).
  if not (v_role = any (array['admin','billing']) or (v_role = 'doctor' and v_o.doctor_id = v_uid)) then
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
drop function if exists public._pedido_es_del_doctor(uuid);
