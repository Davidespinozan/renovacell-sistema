-- AUXILIAR DE ALMACÉN (rol packing) · Blanca: inventario físico (ver y corregir conteo), surtir, empacar y despachar.
-- Recibir mercancía, devoluciones, reingresos, custodia y guías son de Almacén (Alberto): el servidor se los niega.
begin;
do $t$
declare
  v_aux uuid := tests.user('packing'); v_pos uuid := tests.user('pos');
  p uuid; v_l uuid; r jsonb;
begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 500); v_l := tests.stock(p, 'AUX-1', 20);

  -- ══ 1 · lo que SÍ hace ══════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_aux);
  perform tests.ok(exists (select 1 from public.lots where id = v_l), '1.1 · ve el inventario');
  r := public.ajustar_lote(tests.op(), v_l, -1, 'ajuste', 'conteo físico: falta 1');
  perform tests.ok(r is not null, '1.2 · corrige el conteo físico (queda para revisión de Dirección)');
  perform tests.eq(tests.qty(v_l), 19, '1.3 · y la existencia queda en 19');

  -- ══ 2 · lo que NO hace (es de Alberto) ══════════════════════════════════════════════════════════
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'AUX-2', p_caducidad => %L, p_cantidad => 5)$s$, p, current_date + 400), 'NO_AUTORIZADO', '2.1 · no recibe mercancía');
  perform tests.throws(format('select public.abrir_custodia(gen_random_uuid(), %L, %L, %L, null, null, null, null)', 'evento', 'Expo', v_pos), 'NO_AUTORIZADO', '2.2 · no abre custodias');
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), gen_random_uuid(), %L)', '[]'), 'NO_AUTORIZADO', '2.3 · no entrega producto en custodia');
  perform tests.throws(format('select public.devolver_de_custodia(gen_random_uuid(), gen_random_uuid(), %L, null)', '[]'), 'NO_AUTORIZADO', '2.4 · no recibe devoluciones de custodia');
  perform tests.throws(format('select public.registrar_perdida_custodia(gen_random_uuid(), gen_random_uuid(), %L, %L, null, null)', 'robo', '[]'), 'NO_AUTORIZADO', '2.5 · no registra pérdidas de custodia');
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), gen_random_uuid(), %L, null)', '[]'), 'NO_AUTORIZADO', '2.6 · no recibe devoluciones de clientes');
  perform tests.throws(format('select public.confirmar_reingreso(gen_random_uuid(), gen_random_uuid(), %L)', '[]'), 'NO_AUTORIZADO', '2.7 · no confirma reingresos');
  perform tests.throws('select public.anular_guia(gen_random_uuid(), gen_random_uuid(), ''dirección equivocada'')', 'NO_AUTORIZADO', '2.8 · no anula guías');

  -- (que Almacén sigue recibiendo, reingresando y anulando guías lo prueban w1_02, w1_05 y paq_b_00)
end $t$;
rollback;
