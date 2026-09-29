-- W1 · D-06 Merma / ajuste negativo por Almacén (inmediato, auditado); positivo solo Dirección
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing');
  v_pos uuid := tests.user('pos'); v_bill uuid := tests.user('billing'); v_doc uuid := tests.user('doctor');
  v_p uuid := tests.product(); v_l uuid; v_r jsonb; v_op uuid := tests.op(); v_m record;
begin
  v_l := tests.stock(v_p, 'M-1', 10, current_date + 100);

  perform tests.act_as(v_wh);
  v_r := public.ajustar_lote(v_op, v_l, -2, 'merma', 'frasco roto en anaquel');
  perform tests.eq(v_r ->> 'status', 'applied', 'almacén registra merma con efecto inmediato (sin aprobación previa)');
  perform tests.eq(tests.qty(v_l), 8, 'stock baja de inmediato');
  perform tests.act_as_owner();
  select * into v_m from public.inventory_movements where op_id = v_op;
  perform tests.ok(v_m.created_by = v_wh and v_m.reason = 'merma' and v_m.change = -2 and v_m.reference = 'frasco roto en anaquel'
                   and v_m.created_at is not null, 'movimiento con actor, motivo, cantidad y timestamp del servidor');
  perform tests.act_as(v_wh);
  perform tests.eq(public.ajustar_lote(v_op, v_l, -2, 'merma', 'frasco roto en anaquel') ->> 'status', 'already_applied', 'merma idempotente (mismo op_id)');
  perform tests.eq(tests.qty(v_l), 8, 'reintento no baja dos veces');
  perform tests.act_as(v_pk);
  v_r := public.ajustar_lote(tests.op(), v_l, -1, 'ajuste', 'conteo físico: falta 1');
  perform tests.eq(tests.qty(v_l), 7, 'empaque registra ajuste negativo');
  perform tests.act_as(v_admin);
  v_r := public.ajustar_lote(tests.op(), v_l, -1, 'merma', 'muestra dañada');
  perform tests.eq(tests.qty(v_l), 6, 'admin también registra merma');

  -- reglas
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, 2, ''merma'', ''x'')', v_l), 'MERMA_DEBE_SER_NEGATIVA', 'merma nunca crea stock');
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, 3, ''ajuste'', ''apareció'')', v_l), 'NO_AUTORIZADO', 'ajuste POSITIVO: almacén no puede');
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, -1, ''merma'', ''  '')', v_l), 'MOTIVO_REQUERIDO', 'motivo obligatorio');
  perform tests.throws('select public.ajustar_lote(gen_random_uuid(), null, -1, ''merma'', ''x'')', 'LOTE_REQUERIDO', 'lote obligatorio');
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, 0, ''ajuste'', ''x'')', v_l), 'CANTIDAD_INVALIDA', 'ajuste cero rechazado');
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, -7, ''merma'', ''x'')', v_l), 'INVENTARIO_INSUFICIENTE', 'stock nunca queda negativo');
  perform tests.throws(format('select public.ajustar_lote(null, %L, -1, ''merma'', ''x'')', v_l), 'OP_ID_REQUERIDO', 'op_id obligatorio');
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, -1, ''robo'', ''x'')', v_l), 'TIPO_AJUSTE_INVALIDO', 'tipo inválido rechazado');
  perform tests.eq(tests.qty(v_l), 6, 'fallas: CERO efecto');
  foreach v_op in array array[v_pos, v_bill, v_doc] loop
    perform tests.act_as(v_op);
    perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, -1, ''merma'', ''x'')', v_l), 'NO_AUTORIZADO', 'rol sin almacén no da de baja');
  end loop;
  perform tests.act_as(v_admin);
  v_r := public.ajustar_lote(tests.op(), v_l, 4, 'ajuste', 'conteo físico: sobran 4');
  perform tests.eq(tests.qty(v_l), 10, 'ajuste POSITIVO solo Dirección');

  -- visibilidad para Dirección (lista/auditoría + conciliación)
  perform tests.eq((select count(*)::int from public.auditoria_bajas() where lote = 'M-1'), 3, 'auditoría de bajas lista las 3 bajas');
  perform tests.eq((select count(*)::int from public.auditoria_bajas() where lote = 'M-1' and actor = v_wh and motivo = 'frasco roto en anaquel'), 1, 'auditoría muestra actor y motivo');
  perform tests.eq((select count(*)::int from public.conciliar_inventario() where check_id = 'C9_baja_almacen'), 3, 'bajas visibles en la conciliación (C9)');
  perform tests.act_as(v_wh);
  perform tests.throws('select * from public.auditoria_bajas()', 'NO_AUTORIZADO', 'almacén no ve la auditoría de Dirección');
  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_l), 'I-04 tras ajustes: existencia = Σ kardex');
end
$t$;
set constraints all immediate;
rollback;
