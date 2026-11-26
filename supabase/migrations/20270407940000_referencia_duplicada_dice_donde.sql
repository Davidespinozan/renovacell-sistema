-- ============================================================================
-- REFERENCIA DE PAGO REPETIDA: DECIR EN QUÉ VENTA ESTÁ (26 nov 2026, Toño: «no puse esa referencia», venta de $9,000).
--   · Antes, una referencia ya usada caía en el índice único uq_entry_external_ref y el aviso no decía con QUÉ cobro
--     chocaba: nadie podía saber si se equivocó de número o si alguien más la había usado.
--   · Ahora registrar_cobro revisa primero y responde REFERENCIA_DUPLICADA con el folio y el cliente de ese cobro.
--     La regla NO cambia (una referencia = un cobro); el índice sigue siendo la última barrera.
-- Rollback: supabase/rollback/referencia_duplicada/99_down.sql
-- ============================================================================
create or replace function public._w2_referencia_libre(p_reference text)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_folio text; v_cliente text;
begin
  if nullif(btrim(coalesce(p_reference, '')), '') is null then return; end if;
  select coalesce(o.external_ref, 'otro pedido'), coalesce(nullif(btrim(o.shipping_meta -> 'customer' ->> 'name'), ''), p.full_name, '')
    into v_folio, v_cliente
    from public.payment_entries e join public.orders o on o.id = e.order_id left join public.profiles p on p.id = o.doctor_id
   where e.external_ref = p_reference
   limit 1;
  if found then
    raise exception 'REFERENCIA_DUPLICADA: ya está en el cobro de %', v_folio || case when v_cliente <> '' then ' · ' || v_cliente else '' end
      using errcode = 'unique_violation';
  end if;
end;
$function$;
revoke all on function public._w2_referencia_libre(text) from public, anon, authenticated;

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
  -- COBRO-U (23 nov 2026, dueño): Ventas también cobra, solo sus ventas (_venta_puede_cobrar).
  if not (v_srv or public._venta_puede_cobrar(p_order)) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para registrar cobros';
  end if;
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount,
             'value_date', p_value_date, 'reference', p_reference, 'bank', p_bank_account_id, 'evidence', p_evidence);
  v_prev := public._w2_op_begin(p_op_id, 'cobro', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  -- COBRO-U · el vendedor no cobra sobre cancelados ni de más (Dirección sí: F-9, el dinero que llegó se registra).
  if public.auth_role() = 'pos' then
    if v_o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado; avisa a Dirección'; end if;
    if p_amount > coalesce((select m.saldo from public.v_order_money m where m.order_id = p_order), 0) + 0.009 then
      raise exception 'MONTO_MAYOR: el monto es mayor a lo que debe el pedido'; end if;
  end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','stripe','otro') then
    raise exception 'METODO_INVALIDO';
  end if;
  if p_bank_account_id is not null and not exists (
       select 1 from public.company_bank_accounts where id = p_bank_account_id and active) then
    raise exception 'CUENTA_INVALIDA: la cuenta bancaria no existe o está inactiva';
  end if;

  -- REF-DUP (26 nov 2026): una referencia ya usada se rechaza diciendo en qué venta está (antes: índice único mudo).
  perform public._w2_referencia_libre(p_reference);

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
