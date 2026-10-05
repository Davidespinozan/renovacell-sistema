-- CC-0A · v_order_money y v_stock_disponible dejan de ser un atajo sobre la RLS:
-- el doctor ve SOLO el dinero de SUS pedidos (con la aritmética completa del libro),
-- el personal ve su alcance, anon nada; los lotes internos solo los roles de lots.
-- Los comandos W2/W2-C/W5 (SECURITY DEFINER) siguen leyendo todo.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse');
  v_pos uuid := tests.user('pos'); v_drv uuid := tests.user('driver');
  v_a uuid := tests.user('doctor'); v_b uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_l uuid; v_oa uuid; v_ob uuid; v_m record; v_k jsonb;
begin
  v_l := tests.stock(v_p, 'CC0A-L1', 20);
  v_oa := tests.order(v_a, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)), 'pending');
  v_ob := tests.order(v_b, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)), 'pending');
  perform tests.cobrar(v_oa, 50);           -- pago parcial de A: el libro tiene un asiento que el doctor NO puede leer
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  perform tests.act_as_owner();

  -- ══ v_order_money ════════════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.v_order_money', 'permission denied', 'ANON: v_order_money sin privilegio');

  perform tests.act_as(v_a);
  perform tests.eq((select count(*) from public.v_order_money)::int, 1, 'DOCTOR A: ve exactamente 1 pedido (el suyo)');
  select * into v_m from public.v_order_money where order_id = v_oa;
  perform tests.eq(v_m.cobrado_neto, 50::numeric, 'DOCTOR A: cobrado_neto REAL (la aritmética del libro no se degrada)');
  perform tests.eq(v_m.saldo, 150::numeric, 'DOCTOR A: saldo real = 200 − 50');
  perform tests.eq(v_m.estado_pago, 'parcial', 'DOCTOR A: estado_pago real');
  perform tests.eq((select count(*) from public.v_order_money where order_id = v_ob)::int, 0, 'D · DOCTOR A no lee el dinero de B');

  perform tests.act_as(v_b);
  perform tests.eq((select count(*) from public.v_order_money where order_id = v_oa)::int, 0, 'D · DOCTOR B no lee el dinero de A');
  perform tests.eq((select count(*) from public.v_order_money)::int, 1, 'DOCTOR B: solo el suyo');

  perform tests.act_as(v_nov);
  perform tests.eq((select count(*) from public.v_order_money)::int, 0, 'DOCTOR_UNVERIFIED sin pedidos: la vista no es un bypass (0 filas)');

  perform tests.act_as(v_admin);
  perform tests.eq((select count(*) from public.v_order_money where order_id in (v_oa, v_ob))::int, 2, 'ADMIN: ve ambos');
  perform tests.act_as(v_bill);
  perform tests.eq((select count(*) from public.v_order_money where order_id in (v_oa, v_ob))::int, 2, 'BILLING: ve ambos');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*) from public.v_order_money where order_id in (v_oa, v_ob))::int, 2, 'WAREHOUSE: ve ambos (necesita `liberado`)');
  perform tests.eq((select liberado from public.v_order_money where order_id = v_oa), false, 'WAREHOUSE: liberado real (parcial ⇒ no liberado)');
  perform tests.act_as(v_pos);
  perform tests.eq((select count(*) from public.v_order_money where order_id in (v_oa, v_ob))::int, 0, 'POS: solo su cartera (estos pedidos no son suyos)');
  perform tests.act_as(v_drv);
  perform tests.eq((select count(*) from public.v_order_money where order_id in (v_oa, v_ob))::int, 0, 'DRIVER: solo lo que reparte');

  -- Los comandos (definer) siguen viendo todo: el pedido se libera con el cobro completo.
  perform tests.act_as_owner();
  perform tests.cobrar(v_oa, 150);
  perform tests.act_as(v_a);
  perform tests.eq((select estado_pago from public.v_order_money where order_id = v_oa), 'paid', 'DOCTOR A: ve su pedido pagado');
  perform tests.act_as(v_wh);
  perform tests.ok(public.pedido_liberado_para_surtir(v_oa), 'pedido_liberado_para_surtir (definer) sigue leyendo el libro completo');
  perform tests.act_as(v_admin);
  v_k := public.kpi_por_cobrar();
  perform tests.ok((v_k ->> 'pedidos')::int >= 1, 'kpi_por_cobrar (definer) sigue contando (B sigue pendiente)');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación de inventario intacta');
  perform tests.eq((select count(*) from public.conciliar_dinero()), 0::bigint, 'conciliar_dinero: 0 hallazgos');

  -- ══ v_stock_disponible ═══════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.v_stock_disponible', 'permission denied', 'ANON: v_stock_disponible sin privilegio');
  perform tests.act_as(v_a);
  perform tests.eq((select count(*) from public.v_stock_disponible)::int, 0, 'E · DOCTOR_VERIFIED: 0 lotes internos');
  perform tests.act_as(v_nov);
  perform tests.eq((select count(*) from public.v_stock_disponible)::int, 0, 'E · DOCTOR_UNVERIFIED: 0 lotes internos');
  perform tests.act_as(v_drv);
  perform tests.eq((select count(*) from public.v_stock_disponible)::int, 0, 'DRIVER: 0 lotes internos');
  perform tests.act_as(v_wh);
  perform tests.eq((select disponible from public.v_stock_disponible where lot_id = v_l), 20, 'WAREHOUSE: disponible por lote');
  perform tests.act_as(v_pos);
  perform tests.eq((select disponible from public.v_stock_disponible where lot_id = v_l), 20, 'POS: disponible por lote (custodia)');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*) from public.v_stock_disponible where lot_id = v_l)::int, 1, 'ADMIN: lotes');
  -- La disponibilidad que SÍ ve el doctor sigue siendo la agregada (product_stock).
  perform tests.act_as(v_a);
  perform tests.eq((select available from public.product_stock where product_id = v_p), 20, 'DOCTOR_VERIFIED: product_stock agregado intacto');
  perform tests.act_as_owner();
  perform tests.eq(tests.custodia_errores(), 0, 'conciliación de custodia intacta');
end $t$;
rollback;
