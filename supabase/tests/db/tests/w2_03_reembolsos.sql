-- W2 · Reembolso AUTORIZADO ≠ reembolso PAGADO (F-6, D-W2-3, D-W2-5).
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos');
  v_wh uuid := tests.user('warehouse'); v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_ref uuid; v_op uuid; v_m record; v_entry uuid;
begin
  perform tests.stock(v_p, 'W2-RF', 50);
  v_o := tests.order(v_doc, 'delivered', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)), 'paid'); -- 200 cobrados

  -- Autorizar: no mueve dinero
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.autorizar_reembolso(gen_random_uuid(), %L, ''devolucion'', 50, ''x'')', v_o),
    'NO_AUTORIZADO', 'almacén no autoriza reembolsos');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.autorizar_reembolso(gen_random_uuid(), %L, ''devolucion'', 50, ''  '')', v_o),
    'MOTIVO_REQUERIDO', 'el reembolso necesita motivo');
  perform tests.throws(format('select public.autorizar_reembolso(gen_random_uuid(), %L, ''regalo'', 50, ''x'')', v_o),
    'TIPO_INVALIDO', 'tipo inválido rechazado');
  perform tests.throws(format('select public.autorizar_reembolso(gen_random_uuid(), %L, ''devolucion'', 500, ''x'')', v_o),
    'MONTO_EXCEDE', 'no se autoriza más que el total del pedido');
  v_op := tests.op();
  v_ref := (public.autorizar_reembolso(v_op, v_o, 'devolucion', 80, 'producto devuelto') ->> 'refund_id')::uuid;
  perform tests.eq(public.autorizar_reembolso(v_op, v_o, 'devolucion', 80, 'producto devuelto') ->> 'status',
    'already_applied', 'autorización idempotente');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_o and direction = 'out'), 0,
    'D-W2-3: autorizar NO afirma que el dinero salió');
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.eq(v_m.reembolso_pendiente, 80::numeric, 'queda como reembolso PENDIENTE');
  perform tests.eq(v_m.cobrado_neto, 200::numeric, 'el cobrado no cambia por autorizar');

  -- Pagar el reembolso: ahí sí sale el dinero
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.pagar_reembolso(gen_random_uuid(), %L, ''transferencia'')', v_ref),
    'NO_AUTORIZADO', 'POS no paga reembolsos');
  perform tests.act_as(v_bill);
  v_op := tests.op();
  perform tests.eq((public.pagar_reembolso(v_op, v_ref, 'transferencia') ->> 'misma_via')::boolean, true,
    'D-W2-5: misma vía del cobro');
  perform tests.eq(public.pagar_reembolso(v_op, v_ref, 'transferencia') ->> 'status', 'already_applied', 'pago idempotente');
  perform tests.throws(format('select public.pagar_reembolso(gen_random_uuid(), %L, ''transferencia'')', v_ref),
    'REEMBOLSO_YA_PAGADO', 'F-6: un reembolso se paga UNA sola vez');
  perform tests.act_as_owner();
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.eq(v_m.cobrado_neto, 120::numeric, 'cobrado_neto = 200 − 80');
  perform tests.eq(v_m.reembolso_pendiente, 0::numeric, 'ya no hay reembolso pendiente');
  perform tests.eq(v_m.payment_status, 'parcial', 'la proyección baja a parcial tras devolver');

  -- Vía distinta: Dirección + motivo (D-W2-5)
  perform tests.act_as(v_bill);
  v_ref := (public.autorizar_reembolso(tests.op(), v_o, 'correccion', 20, 'ajuste') ->> 'refund_id')::uuid;
  perform tests.throws(format('select public.pagar_reembolso(gen_random_uuid(), %L, ''efectivo'')', v_ref),
    'VIA_DISTINTA_REQUIERE_DIRECCION', 'otra vía requiere Dirección');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.pagar_reembolso(gen_random_uuid(), %L, ''efectivo'')', v_ref),
    'MOTIVO_VIA_REQUERIDO', 'otra vía requiere motivo');
  v_entry := (public.pagar_reembolso(tests.op(), v_ref, 'efectivo', null, null, 'el cliente pidió efectivo') ->> 'entry_id')::uuid;
  perform tests.act_as_owner();
  perform tests.eq((select method from public.payment_entries where id = v_entry), 'efectivo',
    'D-W2-5: se registra la vía REAL utilizada');
  perform tests.ok((select notes like 'Vía distinta%' from public.payment_entries where id = v_entry),
    'el motivo de la vía distinta queda asentado');

  -- Un egreso NO puede existir sin autorización (F-6), ni como dueño
  perform tests.throws(format($s$insert into public.payment_entries (id, order_id, direction, method, amount, actor_role)
    values (gen_random_uuid(), %L, 'out', 'efectivo', 10, 'admin')$s$, v_o),
    'ck_entry_egreso_autorizado', 'F-6: egreso sin reembolso autorizado imposible por constraint');

  -- Reversa: deshace el pago y el reembolso vuelve a quedar pendiente
  perform tests.act_as(v_admin);
  perform tests.eq(public.reversar_asiento(tests.op(), v_entry, 'se pagó dos veces por error') ->> 'status', 'applied',
    'Dirección reversa un asiento');
  perform tests.act_as_owner();
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.eq(v_m.reembolso_pendiente, 20::numeric, 'la reversa deja el reembolso otra vez pendiente');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.reversar_asiento(gen_random_uuid(), %L, ''otra vez'')', v_entry),
    'ASIENTO_YA_REVERSADO', 'un asiento se reversa una sola vez');
end
$t$;
set constraints all immediate;
rollback;
