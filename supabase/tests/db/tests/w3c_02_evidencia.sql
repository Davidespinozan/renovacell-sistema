-- W3-C · C2 — LA EVIDENCIA DE PRECIO NO AUTORIZA NADA FISCAL.
-- La aritmética del Excel histórico no puede decidir un impuesto: para 20 filas donde el
-- precio histórico coincide con el final, "el Excel ya traía el final" y "no es gravado al
-- 16%" son explicaciones igual de compatibles. Eso lo resuelve el contador.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_r jsonb;
begin
  v_p1 := tests.producto_cat('Péptidos');  v_p2 := tests.producto_cat('Medicamentos');
  v_p3 := tests.producto_cat('Toxinas');   v_p4 := tests.producto_cat('Rellenos');
  perform tests.act_as(v_admin);

  v_r := public.importar_evidencia_precios(gen_random_uuid(), jsonb_build_array(
    tests.ev('excel:1', 'HISTORICAL_BASE_PLUS_16', v_p1, 'DIRECT_MATCH', 1000, 1160),
    tests.ev('excel:2', 'HISTORICAL_EQUALS_FINAL', v_p2, 'DIRECT_MATCH', 1760, 1760),
    tests.ev('excel:3', 'HISTORICAL_MISMATCH',     v_p3, 'FAMILY_LEVEL_MATCH', 800, 1500, 'Toxinas'),
    tests.ev('excel:4', 'NO_PUBLIC_REFERENCE',     v_p4, 'DIRECT_MATCH', 8000, null),
    tests.ev('excel:5', 'HISTORICAL_BASE_PLUS_16', null, null, 500, 580, null, 'nombre histórico sin equivalente revisado')));

  perform tests.eq((v_r->>'filas_registradas')::int, 5, 'se registran las 5 filas de origen');
  perform tests.eq((v_r->>'mapeadas')::int, 4, '4 mapeadas');
  perform tests.eq((v_r->>'sin_mapear')::int, 1, '1 sin mapear');

  -- ══ EL INVARIANTE DURO ═══════════════════════════════════════════════════
  perform tests.eq((v_r->>'validados_por_esta_importacion')::int, 0,
    'la importación valida CERO productos, y lo declara en su propio resultado');
  perform tests.eq((v_r->>'validados_en_total')::int, 0, 'y el total de validados sigue en cero');
  perform tests.eq((select count(*)::int from public.product_fiscal where validado), 0,
    'INVARIANTE L-5: tras importar la evidencia completa, 0 productos validados');

  -- ══ NINGUNA clasificación deduce un impuesto ═════════════════════════════
  perform tests.eq((select count(*)::int from public.product_fiscal
                     where clave_prod_serv is not null or clave_unidad is not null
                        or objeto_imp is not null or tratamiento_iva is not null
                        or iva_tasa is not null or descripcion_fiscal is not null), 0,
    'ni un solo campo fiscal se llenó a partir de la aritmética de precios');
  perform tests.ok((select tratamiento_iva is null and iva_tasa is null
                      from public.product_fiscal where product_id = v_p1),
    'BASE_PLUS_16 NO fija IVA al 16%: es evidencia de precio, no autorización fiscal');
  perform tests.ok((select tratamiento_iva is null and objeto_imp is null
                      from public.product_fiscal where product_id = v_p2),
    'EQUALS_FINAL NO fija exento, tasa cero ni no objeto');
  perform tests.ok((select tratamiento_iva is null and clave_prod_serv is null
                      from public.product_fiscal where product_id = v_p3),
    'MISMATCH no inventa ningún dato fiscal');
  perform tests.ok((select tratamiento_iva is null and clave_unidad is null
                      from public.product_fiscal where product_id = v_p4),
    'NO_PUBLIC_REFERENCE tampoco');

  -- ══ PROCEDENCIA preservada (L-4) ═════════════════════════════════════════
  perform tests.eq((select evidencia_procedencia from public.product_fiscal where product_id = v_p1), 'DIRECT_MATCH',
    'se preserva que la coincidencia fue DIRECTA');
  perform tests.eq((select evidencia_procedencia from public.product_fiscal where product_id = v_p3), 'FAMILY_LEVEL_MATCH',
    'y que la otra fue a nivel de FAMILIA');
  perform tests.eq((select familia_publicada from public.fiscal_price_evidence where source_ref = 'excel:3'), 'Toxinas',
    'con el nombre de la familia publicada: no se finge una fila por SKU que no existía');

  -- ══ SIN MAPEAR: se conserva la evidencia y NO se inventa producto (L-2) ══
  perform tests.eq((select count(*)::int from public.fiscal_price_evidence
                     where source_ref = 'excel:5' and mapeo_estado = 'NO_MAPEADO' and product_id is null), 1,
    'la fila sin coincidencia se conserva como evidencia sin resolver');
  perform tests.ok((select mapeo_motivo is not null from public.fiscal_price_evidence where source_ref = 'excel:5'),
    'con su motivo explícito');
  perform tests.eq(v_r->'detalle_sin_mapear'->0->>'source_ref', 'excel:5',
    'y se reporta de forma explícita, no enterrada');
  perform tests.eq((v_r->'por_clasificacion'->>'HISTORICAL_BASE_PLUS_16')::int, 2,
    'el resumen cuenta por clasificación');
  perform tests.eq((v_r->'por_procedencia'->>'FAMILY_LEVEL_MATCH')::int, 1,
    'y por procedencia');

  -- ══ Las excepciones son recuperables por sí mismas ═══════════════════════
  perform tests.eq((select count(*)::int from public.excepciones_evidencia_fiscal()
                     where clasificacion = 'HISTORICAL_EQUALS_FINAL'), 1,
    'las excepciones de mayor revisión se consultan directamente');
  perform tests.ok((select advertencia like '%NO significa exento%' from public.excepciones_evidencia_fiscal()
                     where clasificacion = 'HISTORICAL_EQUALS_FINAL' limit 1),
    'y traen la advertencia que importa');
end $t$;
rollback;

-- ── LA EVIDENCIA ES SUBORDINADA A LA AUTORIDAD HUMANA (L-1) ─────────────────────────────
begin;
do $t$
declare v_admin uuid := tests.user('admin'); v_p uuid; v_at timestamptz; v_r jsonb;
begin
  v_p := tests.producto_cat('Vitaminas');
  perform tests.act_as(v_admin);
  perform tests.pf_validado(v_p, 'tasa_cero', 0);
  select validado_at into v_at from public.product_fiscal where product_id = v_p;

  -- Llega evidencia que, leída a la ligera, "sugeriría" 16%. No cambia nada fiscal.
  v_r := public.importar_evidencia_precios(gen_random_uuid(), jsonb_build_array(
    tests.ev('excel:9', 'HISTORICAL_BASE_PLUS_16', v_p, 'DIRECT_MATCH', 1000, 1160)));

  perform tests.ok((select validado from public.product_fiscal where product_id = v_p),
    'un producto ya validado SIGUE validado tras importar evidencia');
  perform tests.eq((select validado_at from public.product_fiscal where product_id = v_p), v_at,
    'y no se toca su firma de validación');
  perform tests.eq((select tratamiento_iva from public.product_fiscal where product_id = v_p), 'tasa_cero',
    'la evidencia NO pisa la autoridad humana: sigue en tasa cero aunque el precio sugiera 16%');
  perform tests.eq((select iva_tasa from public.product_fiscal where product_id = v_p), 0,
    'ni la tasa');
  perform tests.eq((select evidencia_historica from public.product_fiscal where product_id = v_p), 'HISTORICAL_BASE_PLUS_16',
    'pero la evidencia sí queda registrada para que el contador la vea');
  perform tests.eq((v_r->>'validados_en_total')::int, 1,
    'el total de validados no cambió por la importación');

  -- Las reglas de invalidación de C1 siguen gobernando los campos materiales.
  perform tests.eq((public.editar_fiscal_producto(gen_random_uuid(), v_p,
                      jsonb_build_object('iva_tasa', 0.160000, 'tratamiento_iva', 'gravado'))
                    ->>'invalidado_por_el_cambio')::text, 'true',
    'cambiar el tratamiento sigue invalidando: C1 no se debilitó');
end $t$;
rollback;

-- ── IDEMPOTENCIA, CONFLICTO Y VALIDACIONES DE ENTRADA ───────────────────────────────────
begin;
do $t$
declare v_admin uuid := tests.user('admin'); v_p uuid; v_op uuid := gen_random_uuid(); v_r jsonb; v_filas jsonb;
begin
  v_p := tests.producto_cat('Sérum');
  perform tests.act_as(v_admin);
  v_filas := jsonb_build_array(tests.ev('excel:20', 'HISTORICAL_EQUALS_FINAL', v_p, 'DIRECT_MATCH', 900, 900));

  perform tests.eq(public.importar_evidencia_precios(v_op, v_filas)->>'status', 'applied', 'primera importación');
  perform tests.eq(public.importar_evidencia_precios(v_op, v_filas)->>'status', 'already_applied',
    'el mismo op_id devuelve el resultado ya registrado');
  perform tests.eq((select count(*)::int from public.fiscal_price_evidence where source_ref = 'excel:20'), 1,
    'y no duplica la evidencia');

  -- Mismo op_id con OTRAS filas: conflicto rechazado.
  perform tests.throws(format('select public.importar_evidencia_precios(%L, %L::jsonb)', v_op,
      jsonb_build_array(tests.ev('excel:21', 'HISTORICAL_MISMATCH', v_p, 'DIRECT_MATCH'))),
    'OP_ID_REUTILIZADO', 'reutilizar la identidad de la operación con otros datos se rechaza');

  -- Re-importación con op_id NUEVO y datos IDÉNTICOS: no duplica.
  v_r := public.importar_evidencia_precios(gen_random_uuid(), v_filas);
  perform tests.eq((v_r->>'filas_sin_cambio')::int, 1, 're-importar lo idéntico no agrega observaciones');
  perform tests.eq((select count(*)::int from public.fiscal_price_evidence where source_ref = 'excel:20'), 1,
    'sigue habiendo una sola observación');

  -- Re-importación con datos CORREGIDOS: agrega observación, conserva la anterior.
  v_r := public.importar_evidencia_precios(gen_random_uuid(),
           jsonb_build_array(tests.ev('excel:20', 'HISTORICAL_MISMATCH', v_p, 'DIRECT_MATCH', 900, 1100)));
  perform tests.eq((v_r->>'filas_registradas')::int, 1, 'una corrección sí se registra');
  perform tests.eq((select count(*)::int from public.fiscal_price_evidence where source_ref = 'excel:20'), 2,
    'y la evidencia original NO se pierde: quedan las dos observaciones');
  perform tests.eq((select evidencia_historica from public.product_fiscal where product_id = v_p), 'HISTORICAL_MISMATCH',
    'la proyección refleja la observación más reciente');

  -- Validaciones de entrada
  perform tests.throws(format($q$select public.importar_evidencia_precios(%L, '[]'::jsonb)$q$, gen_random_uuid()),
    'EVIDENCIA_VACIA', 'no se importa una carga vacía');
  perform tests.throws(format($q$select public.importar_evidencia_precios(%L, '[{"source_ref":"x","source_nombre":"y","clasificacion":"INVENTADA"}]'::jsonb)$q$,
      gen_random_uuid()), 'ck_fpe_clasificacion', 'la clasificación es un vocabulario cerrado');
  perform tests.throws(format($q$select public.importar_evidencia_precios(%L, '[{"source_ref":"x","source_nombre":"y","clasificacion":"HISTORICAL_MISMATCH","tasa":"0.16"}]'::jsonb)$q$,
      gen_random_uuid()), 'EVIDENCIA_CAMPO_DESCONOCIDO', 'un campo ajeno se rechaza, no se ignora');
  perform tests.throws(format($q$select public.importar_evidencia_precios(%L, '[{"source_nombre":"y","clasificacion":"HISTORICAL_MISMATCH"}]'::jsonb)$q$,
      gen_random_uuid()), 'EVIDENCIA_ORIGEN_REQUERIDO', 'cada fila lleva su identificador de origen');
  perform tests.throws(format($q$select public.importar_evidencia_precios(%L, %L::jsonb)$q$, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('source_ref','x','source_nombre','y',
        'clasificacion','HISTORICAL_MISMATCH','product_id',gen_random_uuid()::text,'procedencia','DIRECT_MATCH'))),
    'PRODUCTO_INEXISTENTE', 'no se mapea a un producto que no existe');
  -- Un mapeo sin procedencia no se acepta: afirmar una coincidencia exige decir cómo.
  perform tests.throws(format($q$select public.importar_evidencia_precios(%L, %L::jsonb)$q$, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('source_ref','z','source_nombre','y',
        'clasificacion','HISTORICAL_MISMATCH','product_id',v_p::text))),
    'ck_fpe_mapeo_coherente', 'un mapeo sin procedencia se rechaza');
  -- Una coincidencia familiar exige nombrar la familia.
  perform tests.throws(format($q$select public.importar_evidencia_precios(%L, %L::jsonb)$q$, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('source_ref','w','source_nombre','y',
        'clasificacion','HISTORICAL_MISMATCH','product_id',v_p::text,'procedencia','FAMILY_LEVEL_MATCH'))),
    'ck_fpe_familia', 'una coincidencia a nivel de familia exige nombrar la familia');
end $t$;
rollback;

-- ── AUTORIDAD y NO-INTERFERENCIA ────────────────────────────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_doctor uuid := tests.user('doctor'); v_pos uuid := tests.user('pos');
  v_p uuid; v_precio numeric; r record; v_vol int;
begin
  v_p := tests.producto_cat('Aparatología', 1800);
  select price into v_precio from public.products where id = v_p;
  select count(*) into v_vol from public.product_volume_prices;

  -- Importar es de Dirección: define el punto de partida de todo el catálogo.
  for r in select * from (values ('billing', v_bill), ('doctor', v_doctor), ('pos', v_pos)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws(format('select public.importar_evidencia_precios(%L, %L::jsonb)', gen_random_uuid(),
        jsonb_build_array(tests.ev('excel:30', 'HISTORICAL_MISMATCH', v_p, 'DIRECT_MATCH'))),
      'NO_AUTORIZADO', format('el rol %s no importa evidencia histórica', r.rol));
  end loop;

  -- Escritura directa de la evidencia: cerrada.
  for r in select * from (values ('admin', v_admin), ('billing', v_bill), ('doctor', v_doctor)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws_any(format($q$insert into public.fiscal_price_evidence
        (import_op_id, source_ref, source_nombre, clasificacion, mapeo_estado, mapeo_motivo)
        values (%L, 'hack', 'x', 'HISTORICAL_EQUALS_FINAL', 'NO_MAPEADO', 'y')$q$, gen_random_uuid()),
      array['permission denied', 'FISCAL_EVIDENCIA_SOLO_POR_COMANDO', 'row-level security'],
      format('el rol %s no fabrica evidencia a mano', r.rol));
    perform tests.throws_any('delete from public.fiscal_price_evidence',
      array['permission denied', 'LEDGER_APPEND_ONLY', 'row-level security'],
      format('el rol %s no borra evidencia', r.rol));
  end loop;
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.fiscal_price_evidence', 'permission denied',
    'anónimo no tiene ni permiso de lectura sobre la evidencia');

  -- Facturación SÍ lee las excepciones (las trabajará en C3).
  perform tests.act_as(v_bill);
  perform tests.lives('select count(*) from public.excepciones_evidencia_fiscal()',
    'Facturación consulta las excepciones de evidencia');

  -- NO-INTERFERENCIA con lo comercial y lo fiscal de W3-A/B.
  perform tests.act_as(v_admin);
  perform public.importar_evidencia_precios(gen_random_uuid(),
    jsonb_build_array(tests.ev('excel:31', 'HISTORICAL_BASE_PLUS_16', v_p, 'DIRECT_MATCH', 1551.72, 1800)));
  perform tests.eq((select price from public.products where id = v_p), v_precio,
    'el precio comercial del producto NO cambió');
  perform tests.eq((select count(*)::int from public.product_volume_prices), v_vol,
    'las reglas de volumen NO cambiaron');
  perform tests.eq((select count(*)::int from public.fiscal_documents), 0,
    'no se creó ningún documento fiscal');
  perform tests.eq((select count(*)::int from public.fiscal_document_events), 0,
    'ni se tocó su bitácora');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.fiscal_folio_domains), 0,
    'no se asignó ningún folio fiscal');
end $t$;
rollback;
