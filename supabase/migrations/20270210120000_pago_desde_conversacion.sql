-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PAGO-DESDE-CONVERSACIÓN (29 oct 2026) · bloque 4 del expediente del vendedor.
--   Dueño: "el vendedor le hace la cotización, se la manda, le hace la venta por ahí mismo por el chat, por ahí mismo le
--   manda el comprobante de pago… sin necesidad de que la señora entre a su portal… siempre bien ligado a su expediente".
--   · El vendedor de ese cliente (o Dirección) REPORTA el pago de un pedido del cliente con la foto del comprobante que
--     el cliente mandó en SU conversación (WhatsApp, enlace). Reportar ≠ cobrar: nace una declaración en payment_claims
--     igual a la del portal y la valida Dirección en "Pagos por validar" (revisar_pago, sin cambios). El vendedor nunca
--     escribe en el libro.
--   · reportar_pago (D-SECB-1: el vendedor no reporta) NO se toca: esta es una vía aparte y más estrecha — exige un
--     comprobante que mandó el propio cliente en una conversación ligada a su ficha, y solo de pedidos hechos a esa ficha.
--   · La foto vive en el bucket privado 'chat'; la Edge report-transfer la copia a 'proofs' (donde Dirección ya ve los
--     comprobantes) en una ruta fija por adjunto, y la declaración la guarda. Se valida aquí que la ruta sea esa.
--   · cc_cliente_pedidos: pedidos del cliente con saldo, comprobante en revisión y último pago validado (para el recibo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cc_vendedor_de_cliente(uuid)') is null or to_regprocedure('public._cc_puede_ver_conv(uuid)') is null
     or to_regprocedure('public._w2_op_begin(uuid,text,jsonb)') is null or to_regprocedure('public._w2_op_finish(uuid,text,jsonb,jsonb)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cc_conversations' and column_name = 'customer_id') then
    raise exception 'PAGO-DESDE-CONVERSACIÓN: falta VINCULAR-CLIENTE (20270206) o W2; revisar antes de aplicar'; end if;
end $pre$;

-- ¿Quién llama puede trabajar el dinero de este pedido desde una conversación? Dirección, o el vendedor de la ficha del
-- pedido (cartera) que además puede ver la conversación. Devuelve el adjunto validado o lanza.
create function public._cc_pago_adjunto(p_order uuid, p_adjunto uuid, out id uuid, out ruta text, out tipo text, out conversation_id uuid)
  language plpgsql stable security definer set search_path = public as
$$
declare v_role text := public.auth_role(); v_uid uuid := auth.uid(); v_cust uuid;
begin
  select o.customer_id into v_cust from public.orders o where o.id = p_order;
  -- Pedido ajeno, sin ficha o inexistente responden lo mismo (no se revela si existe).
  if v_cust is null or not (v_role = 'admin' or (v_role = 'pos' and v_uid is not null and public._cc_vendedor_de_cliente(v_cust) = v_uid)) then
    raise exception 'NO_AUTORIZADO: no puedes reportar un pago de este pedido'; end if;
  select ad.id, ad.ruta, ad.tipo, ad.conversation_id into id, ruta, tipo, conversation_id
    from public.cc_adjuntos ad
    join public.cc_messages m on m.id = ad.message_id
    join public.cc_conversations c on c.id = ad.conversation_id
   where ad.id = p_adjunto and m.actor_type = 'visitor' and c.customer_id = v_cust;
  if not found then raise exception 'ADJUNTO_NO_ES_DEL_CLIENTE: el comprobante tiene que ser una foto que el cliente mandó en su conversación'; end if;
  if not public._cc_puede_ver_conv(conversation_id) then raise exception 'NO_AUTORIZADO: no puedes reportar un pago de este pedido'; end if;
end;
$$;
revoke all on function public._cc_pago_adjunto(uuid, uuid) from public, anon, authenticated;

-- Ruta fija del comprobante en 'proofs' para ese adjunto (la Edge copia ahí; el comando exige exactamente esa).
create function public._cc_pago_ruta(p_order uuid, p_adjunto uuid, p_tipo text) returns text
  language sql immutable set search_path = public as
$$ select 'transfers/' || p_order || '/chat-' || p_adjunto || case when p_tipo = 'image/png' then '.png' else '.jpg' end $$;
revoke all on function public._cc_pago_ruta(uuid, uuid, text) from public, anon, authenticated;

-- Paso previo de la Edge (con el JWT de quien llama): autoriza y le dice qué foto copiar y a dónde. No escribe nada.
create function public.cc_pago_comprobante_preparar(p_order uuid, p_adjunto uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._cc_pago_adjunto(p_order, p_adjunto);
  return jsonb_build_object('ruta_chat', a.ruta, 'tipo', a.tipo, 'ruta_comprobante', public._cc_pago_ruta(p_order, a.id, a.tipo));
end;
$$;
revoke all on function public.cc_pago_comprobante_preparar(uuid, uuid) from public, anon;
grant execute on function public.cc_pago_comprobante_preparar(uuid, uuid) to authenticated, service_role;

-- COMANDO · el vendedor (o Dirección) reporta el pago del cliente con su comprobante del chat. Mismas reglas de dinero
-- que reportar_pago (saldo, método, una declaración abierta por pedido, idempotencia por op_id); queda para validar.
create function public.cc_reportar_pago_cliente(p_op_id uuid, p_order uuid, p_method text, p_amount numeric,
                                                p_reference text, p_adjunto uuid, p_proof_path text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_req jsonb; v_prev jsonb; v_o record; v_saldo numeric; a record;
begin
  -- Autoridad ANTES de la idempotencia (un op_id repetido por quien no tiene derecho no devuelve el saldo guardado).
  select * into a from public._cc_pago_adjunto(p_order, p_adjunto);
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount, 'reference', p_reference,
             'adjunto', p_adjunto, 'proof', p_proof_path, 'via', 'conversacion');
  v_prev := public._w2_op_begin(p_op_id, 'reporte_pago', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  select * into a from public._cc_pago_adjunto(p_order, p_adjunto);   -- re-chequeo bajo el bloqueo del pedido
  select m.saldo into v_saldo from public.v_order_money m where m.order_id = p_order;
  if p_proof_path is distinct from public._cc_pago_ruta(p_order, a.id, a.tipo) then
    raise exception 'COMPROBANTE_INVALIDO: el comprobante no corresponde a esa foto'; end if;
  if v_o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado'; end if;
  if v_saldo <= 0 then raise exception 'SIN_SALDO: ese pedido no tiene saldo por cobrar'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;
  if p_amount > v_saldo then raise exception 'MONTO_MAYOR_AL_SALDO: el monto es mayor a lo que debe (%)', v_saldo; end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','otro') then
    raise exception 'METODO_INVALIDO'; end if;
  if exists (select 1 from public.payment_claims c where c.order_id = p_order and c.status = 'reportado') then
    raise exception 'DECLARACION_ABIERTA: ya hay un comprobante en revisión para este pedido'; end if;
  if exists (select 1 from public.payment_claims c where c.proof_path = p_proof_path and c.status <> 'rechazado') then
    raise exception 'COMPROBANTE_YA_USADO: esa foto ya respalda otro pago'; end if;

  insert into public.payment_claims (id, order_id, method, amount_declared, reference, bank_account_id, proof_path, declared_by)
  values (p_op_id, p_order, p_method, p_amount, nullif(btrim(p_reference), ''), null, p_proof_path, v_uid);

  return public._w2_op_finish(p_op_id, 'reporte_pago', v_req,
    jsonb_build_object('status', 'applied', 'claim_id', p_op_id, 'order_id', p_order, 'saldo', v_saldo,
                       'folio', v_o.external_ref));
end;
$$;
revoke all on function public.cc_reportar_pago_cliente(uuid, uuid, text, numeric, text, uuid, text) from public, anon;
grant execute on function public.cc_reportar_pago_cliente(uuid, uuid, text, numeric, text, uuid, text) to authenticated, service_role;

-- LECTURA · pedidos del cliente ligado a la conversación: saldo, comprobante en revisión y último pago validado.
create function public.cc_cliente_pedidos(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_role text := public.auth_role(); v_cust uuid;
begin
  select c.customer_id into v_cust from public.cc_conversations c where c.id = p_conv;
  if v_cust is null or not public._cc_puede_ver_conv(p_conv)
     or not (v_role = 'admin' or (v_role = 'pos' and public._cc_vendedor_de_cliente(v_cust) = auth.uid())) then
    raise exception 'NO_AUTORIZADO: no puedes ver los pedidos de este cliente'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'fecha' desc) from (
      select jsonb_build_object(
        'id', o.id, 'folio', o.external_ref, 'fecha', o.created_at, 'total', o.total, 'estado', o.status,
        'saldo', coalesce(m.saldo, o.total), 'cobrado', coalesce(m.cobrado_neto, 0), 'estado_pago', m.estado_pago,
        'en_revision', exists (select 1 from public.payment_claims k where k.order_id = o.id and k.status = 'reportado'),
        'ultimo_pago', (select jsonb_build_object('monto', e.amount, 'fecha', e.value_date, 'metodo', e.method)
                          from public.payment_entries e where e.order_id = o.id and e.direction = 'in' and e.reversal_of is null
                         order by e.created_at desc limit 1)) x
        from public.orders o left join public.v_order_money m on m.order_id = o.id
       where o.customer_id = v_cust and o.status <> 'cancelled'
       order by o.created_at desc limit 10) t), '[]'::jsonb);
end;
$$;
revoke all on function public.cc_cliente_pedidos(uuid) from public, anon;
grant execute on function public.cc_cliente_pedidos(uuid) to authenticated, service_role;

do $post$ begin
  if to_regprocedure('public.cc_reportar_pago_cliente(uuid,uuid,text,numeric,text,uuid,text)') is null
     or to_regprocedure('public.cc_cliente_pedidos(uuid)') is null then
    raise exception 'PAGO-DESDE-CONVERSACIÓN: no quedó aplicada'; end if;
end $post$;
