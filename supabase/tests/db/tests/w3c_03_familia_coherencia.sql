-- W3-C · C4-D — Candidatos por FAMILIA, coherencia objeto↔tratamiento y compuerta
-- fiscal del pedido.
--
-- Lo que se protege: que una propuesta siga siendo una propuesta (nunca valida, nunca
-- pisa un valor, nunca toca un producto validado), que el modelo no pueda guardar una
-- combinación fiscal que se contradice a sí misma, y que vender no exija lo que exige
-- facturar.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_pos uuid := tests.user('pos');
  v_a1 uuid; v_a2 uuid; v_b1 uuid; v_c1 uuid; v_op uuid; j jsonb; v_n int;
begin
  perform tests.act_as(v_admin);

  -- ── 1 · COHERENCIA ESTRUCTURAL (C-2) ──────────────────────────────────────
  perform tests.ok(public._pf_objeto_coherente('01','no_objeto'),     'c1: 01 con no objeto es coherente');
  perform tests.ok(public._pf_objeto_coherente('02','gravado'),       'c1: 02 con gravado es coherente');
  perform tests.ok(public._pf_objeto_coherente('02','exento'),        'c1: 02 con exento es coherente');
  perform tests.ok(public._pf_objeto_coherente('03','tasa_cero'),     'c1: 03 con tasa cero es coherente');
  perform tests.ok(not public._pf_objeto_coherente('01','gravado'),   'c1: 01 con gravado se rechaza');
  perform tests.ok(not public._pf_objeto_coherente('01','exento'),    'c1: 01 con exento se rechaza');
  perform tests.ok(not public._pf_objeto_coherente('02','no_objeto'), 'c1: 02 con no objeto se rechaza');
  perform tests.ok(not public._pf_objeto_coherente('03','no_objeto'), 'c1: 03 con no objeto se rechaza');
  -- Con un nulo no se afirma nada: el producto solo está incompleto.
  perform tests.ok(public._pf_objeto_coherente(null,'gravado'),       'c1: objeto nulo no afirma nada');
  perform tests.ok(public._pf_objeto_coherente('01',null),            'c1: tratamiento nulo no afirma nada');

  -- Y la base lo impide de verdad, no solo la función suelta.
  v_c1 := tests.producto_cat('PruebaCoherencia');
  perform tests.throws_any(
    format($q$select public.editar_fiscal_producto(%L, %L, '{"objeto_imp":"01","tratamiento_iva":"gravado","iva_tasa":"0.16"}'::jsonb)$q$,
           gen_random_uuid(), v_c1),
    array['ck_pf_objeto_tratamiento','ck_pf_tasa'],
    'c2: el comando no puede guardar 01 + gravado');
  perform tests.throws_any(
    format($q$select public.editar_fiscal_producto(%L, %L, '{"objeto_imp":"02","tratamiento_iva":"no_objeto"}'::jsonb)$q$,
           gen_random_uuid(), v_c1),
    array['ck_pf_objeto_tratamiento'],
    'c3: tampoco 02 + no objeto');
  -- La combinación coherente SÍ se acepta.
  perform public.editar_fiscal_producto(gen_random_uuid(), v_c1,
    '{"objeto_imp":"01","tratamiento_iva":"no_objeto"}'::jsonb);
  perform tests.ok((select objeto_imp = '01' and tratamiento_iva = 'no_objeto'
                      from public.product_fiscal where product_id = v_c1),
    'c4: 01 + no objeto se guarda sin problema');

  -- ── 2 · CANDIDATOS POR FAMILIA (C-1) ──────────────────────────────────────
  -- Dos familias DENTRO de la misma categoría: el caso real de Péptidos.
  v_a1 := tests.producto_fam('PruebaCat','FamiliaA');
  v_a2 := tests.producto_fam('PruebaCat','FamiliaA');
  v_b1 := tests.producto_fam('PruebaCat','FamiliaB');

  perform tests.throws(
    format('select public.aplicar_defaults_familia(%L, %L)', gen_random_uuid(), 'FamiliaA'),
    'DEFAULTS_FAMILIA_INEXISTENTES', 'f1: aplicar sin definir antes falla · nada se propaga solo');

  perform public.definir_defaults_familia(gen_random_uuid(), 'FamiliaA',
    '{"clave_prod_serv":"51241100","clave_unidad":"H87","objeto_imp":"02","tratamiento_iva":"gravado","iva_tasa":"0.16"}'::jsonb);
  perform tests.eq((select count(*)::int from public.fiscal_family_defaults where familia='FamiliaA'), 1,
    'f2: la familia quedó definida');

  j := public.aplicar_defaults_familia(gen_random_uuid(), 'FamiliaA');
  perform tests.eq((j->>'productos_prellenados')::int, 2, 'f3: pre-llenó los 2 productos de FamiliaA');
  perform tests.eq((j->>'validados_por_esta_operacion')::int, 0, 'f4: declara explícitamente 0 validados');
  perform tests.eq((select count(*)::int from public.product_fiscal where validado), 0,
    'f5: NINGÚN producto quedó validado por aplicar candidatos');

  -- No tocó la otra familia de la MISMA categoría: justo lo que C-1 buscaba.
  -- Sin fila la subconsulta da NULL, no TRUE: se pregunta por la AUSENCIA.
  perform tests.ok(not exists (select 1 from public.product_fiscal
                                where product_id = v_b1 and clave_prod_serv is not null),
    'f6: FamiliaB quedó intacta aunque comparte categoría con FamiliaA');

  -- ── 3 · UNA PROPUESTA NO PISA NI INVALIDA ─────────────────────────────────
  perform public.definir_defaults_familia(gen_random_uuid(), 'FamiliaB',
    '{"clave_prod_serv":"11111111","clave_unidad":"E48","objeto_imp":"02","tratamiento_iva":"gravado","iva_tasa":"0.16"}'::jsonb);
  perform tests.pf_validado(v_b1);
  perform tests.ok((select validado from public.product_fiscal where product_id = v_b1), 'f7: b1 quedó validado');
  perform public.aplicar_defaults_familia(gen_random_uuid(), 'FamiliaB');
  perform tests.ok((select clave_prod_serv = '51241100' from public.product_fiscal where product_id = v_b1),
    'f8: el producto validado conserva SU valor · el candidato no lo pisó');
  perform tests.ok((select validado from public.product_fiscal where product_id = v_b1),
    'f9: y sigue validado · aplicar candidatos no invalida');

  -- ── 3b · EL PAR OBJETO/TRATAMIENTO ES INDIVISIBLE ─────────────────────────
  declare v_par uuid;
  begin
    v_par := tests.producto_fam('PruebaCat','FamiliaPar');
    -- El producto trae SOLO el objeto de impuesto, sin tratamiento.
    perform public.editar_fiscal_producto(gen_random_uuid(), v_par, '{"objeto_imp":"01"}'::jsonb);
    -- Y el candidato propone un tratamiento que con '01' sería contradictorio.
    perform public.definir_defaults_familia(gen_random_uuid(), 'FamiliaPar',
      '{"clave_prod_serv":"51241100","objeto_imp":"02","tratamiento_iva":"gravado","iva_tasa":"0.16"}'::jsonb);
    perform tests.lives(format('select public.aplicar_defaults_familia(%L, ''FamiliaPar'')', gen_random_uuid()),
      'f20: aplicar candidatos no revienta cuando el producto ya traía medio par');
    perform tests.ok((select objeto_imp = '01' and tratamiento_iva is null
                        from public.product_fiscal where product_id = v_par),
      'f21: el par no se mezcló · el producto conserva su objeto y sigue sin tratamiento');
    perform tests.ok((select clave_prod_serv = '51241100'
                        from public.product_fiscal where product_id = v_par),
      'f22: los campos que NO son del par sí se pre-llenaron');
  end;

  -- ── 4 · IDEMPOTENCIA ──────────────────────────────────────────────────────
  v_op := gen_random_uuid();
  perform public.aplicar_defaults_familia(v_op, 'FamiliaA');
  j := public.aplicar_defaults_familia(v_op, 'FamiliaA');
  perform tests.eq(j->>'status', 'already_applied', 'f10: reejecutar con el mismo op_id no repite el efecto');
  perform tests.throws(
    format('select public.aplicar_defaults_familia(%L, %L)', v_op, 'FamiliaB'),
    'OP_ID_REUTILIZADO', 'f11: el mismo op_id con otros datos se rechaza');
  perform tests.throws(
    'select public.aplicar_defaults_familia(null, ''FamiliaA'')',
    'OP_ID_REQUERIDO', 'f12: toda operación lleva identificador');

  -- ── 5 · LA UNIDAD COMERCIAL NO ES CLAVE DEL SAT ───────────────────────────
  perform tests.ok((select p.unit = 'Unidades' and pf.clave_unidad = 'H87'
                      from public.products p join public.product_fiscal pf on pf.product_id = p.id
                     where p.id = v_a1),
    'f13: la unidad comercial y la clave de unidad del SAT son datos distintos');

  -- ── 6 · LA EVIDENCIA HISTÓRICA NO ENTRA POR AQUÍ ──────────────────────────
  perform tests.ok((select evidencia_historica is null from public.product_fiscal where product_id = v_a1),
    'f14: aplicar candidatos no inventa evidencia histórica');

  -- ── 7 · VENDIBLE AUNQUE NO ESTÉ VALIDADO ──────────────────────────────────
  perform tests.ok((select sellable from public.products where id = v_a1),
    'f15: un producto sin validación fiscal sigue siendo vendible');

  -- ── 8 · COMPUERTA FISCAL DEL PEDIDO (D6) ──────────────────────────────────
  declare v_order uuid; v_doc uuid := tests.user('doctor');
  begin
    -- Pedido con dos renglones: uno validado (b1) y uno sin validar (a1).
    v_order := tests.order(v_doc, 'pending_payment',
      format('[{"product_id":"%s","qty":1,"unit_price":1000},{"product_id":"%s","qty":1,"unit_price":1000}]',
             v_a1, v_b1)::jsonb);
    select count(*)::int into v_n from public.pedido_fiscalmente_listo(v_order);
    perform tests.eq(v_n, 1, 'g1: el pedido reporta 1 producto que aún no puede facturarse');
    perform tests.ok((select product_id = v_a1 from public.pedido_fiscalmente_listo(v_order)),
      'g2: señala exactamente el producto sin validar, no el validado');
    perform tests.pf_validado(v_a1);
    select count(*)::int into v_n from public.pedido_fiscalmente_listo(v_order);
    perform tests.eq(v_n, 0, 'g3: con todos validados, la compuerta queda abierta');
  end;

  -- ── 9 · AUTORIDAD ─────────────────────────────────────────────────────────
  perform tests.act_as(v_pos);
  perform tests.throws(
    format('select public.definir_defaults_familia(%L, %L, ''{}''::jsonb)', gen_random_uuid(), 'FamiliaA'),
    'NO_AUTORIZADO', 'f16: mostrador no define candidatos por familia');
  perform tests.throws(
    format('select public.aplicar_defaults_familia(%L, %L)', gen_random_uuid(), 'FamiliaA'),
    'NO_AUTORIZADO', 'f17: mostrador no aplica candidatos por familia');
  perform tests.act_as(v_admin);

  -- ── 10 · LA TABLA NO SE ESCRIBE A MANO ────────────────────────────────────
  perform tests.throws_any(
    'insert into public.fiscal_family_defaults (familia) values (''AMano'')',
    array['FISCAL_DEFAULTS_SOLO_POR_COMANDO','permission denied','row-level security'],
    'f18: la tabla de candidatos solo cambia por comando');

  -- ── 11 · CAMPO DESCONOCIDO ────────────────────────────────────────────────
  perform tests.throws(
    format('select public.definir_defaults_familia(%L, %L, ''{"inventado":"x"}''::jsonb)', gen_random_uuid(), 'FamiliaA'),
    'CAMPO_FISCAL_DESCONOCIDO', 'f19: un campo que no existe no se acepta en silencio');
end $t$;
rollback;
