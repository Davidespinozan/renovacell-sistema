-- COBRO AL ENTREGAR (19 nov 2026, dueño: «¿el chofer cobra al entregar? no siempre pero por lo general sí»).
-- Antes el chofer no tenía dónde registrar lo que cobraba (registrar_cobro es solo de Dirección/Facturación) y Dirección
-- no veía ese dinero. Ahora:
--   · entrega_cobro_estado(envío): lo que el chofer necesita saber en la puerta (total, saldo, si ya está pagado).
--   · registrar_cobro_entrega(op, envío, método, monto, referencia): SOLO el chofer de ESE envío, efectivo o transferencia,
--     monto > 0 y nunca más que el saldo, nunca sobre un pedido cancelado. Entra al MISMO libro de dinero (asiento 'in')
--     con la referencia «Cobro al entregar · <chofer>», idempotente por op (un doble toque no cobra dos veces).
create or replace function public.entrega_cobro_estado(p_shipment uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare s record; m record;
begin
  select sh.id, sh.order_id, sh.driver_id into s from public.shipments sh where sh.id = p_shipment;
  if not found or not (s.driver_id = auth.uid() or public.auth_role() in ('admin', 'billing')) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into m from public.v_order_money where order_id = s.order_id;
  return jsonb_build_object('order_id', s.order_id, 'total', m.total, 'cobrado', m.cobrado_neto, 'saldo', greatest(coalesce(m.saldo, 0), 0),
                            'payment_status', m.payment_status, 'credito', coalesce(m.credito_autorizado, false), 'cancelado', m.order_status = 'cancelled');
end;
$$;

create or replace function public.registrar_cobro_entrega(p_op_id uuid, p_shipment uuid, p_metodo text, p_monto numeric, p_referencia text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare s record; o record; m record; v_req jsonb; v_prev jsonb; v_entry uuid; v_estado text; v_chofer text; v_ref text;
begin
  if public.auth_role() <> 'driver' then raise exception 'NO_AUTORIZADO: solo el chofer registra el cobro al entregar' using errcode = 'insufficient_privilege'; end if;
  select sh.id, sh.order_id, sh.driver_id, sh.status into s from public.shipments sh where sh.id = p_shipment;
  if not found or s.driver_id is distinct from auth.uid() then raise exception 'NO_AUTORIZADO: esa entrega no es tuya' using errcode = 'insufficient_privilege'; end if;
  if s.status = 'cancelado' then raise exception 'ENTREGA_CANCELADA: esa entrega se canceló' using errcode = 'check_violation'; end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia') then raise exception 'METODO_INVALIDO: efectivo o transferencia' using errcode = 'check_violation'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'MONTO_INVALIDO: escribe cuánto cobraste' using errcode = 'check_violation'; end if;
  v_req := jsonb_build_object('shipment', p_shipment, 'metodo', p_metodo, 'monto', p_monto, 'referencia', p_referencia);
  v_prev := public._w2_op_begin(p_op_id, 'cobro', v_req);
  if v_prev is not null then return v_prev; end if;
  select * into o from public.orders where id = s.order_id for update;
  if o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado; no cobres' using errcode = 'check_violation'; end if;
  select * into m from public.v_order_money where order_id = s.order_id;
  if coalesce(m.saldo, 0) <= 0 then raise exception 'YA_PAGADO: ese pedido ya está pagado; no cobres' using errcode = 'check_violation'; end if;
  if p_monto > m.saldo + 0.009 then raise exception 'MONTO_MAYOR: el saldo es de % ; no cobres de más', to_char(m.saldo, 'FM$999,999,990.00') using errcode = 'check_violation'; end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_chofer from public.profiles where id = auth.uid();
  v_ref := left('Cobro al entregar · ' || coalesce(v_chofer, 'chofer') || coalesce(' · ' || nullif(btrim(p_referencia), ''), ''), 200);
  v_entry := public._w2_asiento(p_op_id, s.order_id, 'in', p_metodo, round(p_monto, 2), public.hoy_local(), null, null, v_ref, null, null);
  v_estado := public._w2_recalc_payment_status(s.order_id);
  select * into m from public.v_order_money where order_id = s.order_id;
  return public._w2_op_finish(p_op_id, 'cobro', v_req,
    jsonb_build_object('status', 'applied', 'entry_id', v_entry, 'order_id', s.order_id, 'payment_status', v_estado, 'cobrado_neto', m.cobrado_neto, 'saldo', m.saldo));
end;
$$;

revoke all on function public.entrega_cobro_estado(uuid), public.registrar_cobro_entrega(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.entrega_cobro_estado(uuid), public.registrar_cobro_entrega(uuid, uuid, text, numeric, text) to authenticated;
