-- W1 · D-05 Identidad canónica del lote (Modelo A) + caducidad server-side
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_p uuid := tests.product(); v_p2 uuid := tests.product();
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_r jsonb; v_exp date := current_date + 200;
begin
  perform tests.act_as(v_admin);
  -- normalización: espacios de borde / internos repetidos / mayúsculas ⇒ MISMO lote
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'AB 12', p_caducidad => v_exp,
           p_cantidad => 5, p_kind => 'sin_orden', p_reason => 'prueba');
  v_l1 := (v_r ->> 'lot_id')::uuid;
  perform tests.eq(v_r ->> 'lot_created', 'true', 'primer ingreso crea el lote');
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => '  ab    12 ', p_caducidad => v_exp,
           p_cantidad => 3, p_kind => 'sin_orden', p_reason => 'prueba');
  perform tests.eq((v_r ->> 'lot_id')::uuid, v_l1, 'mismo producto + código normalizado ⇒ mismo lote');
  perform tests.eq(tests.qty(v_l1), 8, 'la existencia se acumula en el lote canónico');
  -- códigos realmente distintos NO se fusionan
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'AB-12', p_caducidad => v_exp,
           p_cantidad => 1, p_kind => 'sin_orden', p_reason => 'prueba');
  perform tests.ok((v_r ->> 'lot_id')::uuid <> v_l1, 'AB-12 ≠ AB 12 (guiones se conservan)');
  -- mismo código en OTRO producto ⇒ otro lote
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p2, p_lote => 'AB 12', p_caducidad => v_exp,
           p_cantidad => 1, p_kind => 'sin_orden', p_reason => 'prueba');
  perform tests.ok((v_r ->> 'lot_id')::uuid <> v_l1, 'el código es único por producto');

  -- misma identidad + otra caducidad ⇒ RECHAZO (no fusiona, no sustituye)
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'ab 12',
    p_caducidad => %L, p_cantidad => 1, p_kind => 'sin_orden', p_reason => 'x')$s$, v_p, v_exp + 1),
    'LOTE_CADUCIDAD_DISTINTA', 'misma identidad con otra caducidad se rechaza');
  perform tests.eq((select expiry_date from public.lots where id = v_l1), v_exp, 'la caducidad original no se sustituye');

  -- caducado / sin caducidad ⇒ no entra como stock
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'OLD-1',
    p_caducidad => %L, p_cantidad => 1, p_kind => 'sin_orden', p_reason => 'x')$s$, v_p, public.hoy_local() - 1),
    'CADUCADO_NO_RECIBIBLE', 'producto caducado (ayer, hora local) no se recibe');
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'NOEXP',
    p_caducidad => null, p_cantidad => 1, p_kind => 'sin_orden', p_reason => 'x')$s$, v_p),
    'CADUCIDAD_REQUERIDA', 'recepción sin caducidad se rechaza');
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'HOY-1', p_caducidad => public.hoy_local(),
           p_cantidad => 1, p_kind => 'sin_orden', p_reason => 'prueba');
  perform tests.eq(v_r ->> 'status', 'applied', 'caduca HOY (local) ⇒ aún vigente, se recibe');
  perform tests.ok(public.lote_caducado(public.hoy_local() - 1) and not public.lote_caducado(public.hoy_local()), 'lote_caducado: vigente hasta el día inclusive');
  perform tests.ok(public.lote_caducado(null), 'sin fecha ⇒ no vendible (falla cerrado)');

  -- estructura: UNIQUE, NOT NULL, ubicación informativa, FK RESTRICT
  perform tests.act_as_owner();
  perform tests.throws(format($s$insert into public.lots(product_id, lot_code, expiry_date, quantity) values (%L, 'AB  12', %L, 0)$s$, v_p, v_exp),
    'uq_lots_product_code', 'la BD impide duplicar la identidad aunque se escriba directo');
  perform tests.throws(format($s$insert into public.lots(product_id, lot_code, quantity) values (%L, 'SIN-FECHA', 0)$s$, v_p),
    'expiry_date', 'expiry_date es NOT NULL');
  perform tests.throws($s$insert into public.lots(lot_code, expiry_date, quantity) values ('SIN-PROD', current_date + 10, 0)$s$,
    'product_id', 'product_id es NOT NULL');
  perform tests.throws(format($s$insert into public.lots(product_id, lot_code, expiry_date, quantity) values (%L, '   ', %L, 0)$s$, v_p, v_exp),
    'ck_lots_code_not_blank', 'código vacío rechazado');
  perform tests.eq((select location from public.lots where id = v_l1), 'Culiacán', 'ubicación informativa única por defecto');
  perform tests.throws(format('delete from public.products where id = %L', v_p), 'violates foreign key', 'borrar un producto NO borra sus lotes (RESTRICT)');
  perform tests.throws(format('update public.lots set quantity = -1 where id = %L', v_l1), 'lots_quantity_nonneg', 'no-negatividad VALIDADA');
  perform tests.eq(public.lote_code_norm('  Ab   12 '), (select lot_code_norm from public.lots where id = v_l1), 'misma normalización en comando y columna generada');
  perform tests.ok(tests.kardex_ok(v_l1), 'I-04: existencia = Σ kardex');
end
$t$;
set constraints all immediate;
rollback;
