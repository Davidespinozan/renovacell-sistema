-- CC-3 · Modelo de conocimiento: secciones cerradas con nivel derivado, ciclo de vida
-- draft→approved→retired con versiones inmutables, fuente obligatoria en T1/T2, T2 bloqueado
-- por defecto, claims, relaciones curadas, alias de descubrimiento, bitácora append-only,
-- importación del conocimiento existente SOLO como borrador e idempotente.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor');
  pA uuid; pB uuid; pC uuid; src uuid; r jsonb; d1 uuid; d2 uuid; t2 uuid; n int; ev int; imp jsonb; al uuid; rel uuid; emp uuid;
begin
  perform tests.act_as_service();
  pA := tests.producto_fam('Bioestimuladores', 'Familia X'); pB := tests.producto_fam('Bioestimuladores', 'Familia X'); pC := tests.producto_cat('Rellenos');
  update public.products set name = 'Producto Alfa 2 ml', odoo_reference = 'Caja con 2 jeringas · 2 ml', metadata = '{"tagline":"Hidratación profunda","chips":["Ácido hialurónico","Sin lidocaína"]}'::jsonb, brochure_url = 'https://ejemplo.test/folleto-alfa.pdf' where id = pA;
  update public.products set name = 'Producto Beta 1 ml', odoo_reference = 'Caja con 1 jeringa · 1 ml' where id = pB;
  select count(*) into ev from public.cc_knowledge_events;

  -- ══ niveles y audiencia derivados ═══════════════════════════════════════════
  perform tests.eq(public._cc_nivel_seccion('resumen'), 'T0', 'A · resumen es T0');
  perform tests.eq(public._cc_nivel_seccion('composicion'), 'T1', 'A · composición es T1');
  perform tests.eq(public._cc_nivel_seccion('indicaciones'), 'T2', 'A · indicaciones es T2');
  perform tests.ok(public._cc_nivel_seccion('precio') is null and public._cc_nivel_seccion('stock') is null, 'A · precio/stock NO son secciones de conocimiento');
  perform tests.eq(public._cc_audiencia_minima('T1'), 'verified', 'T1 nace como verified');
  perform tests.eq((select t2_habilitado from public.cc_knowledge_config), false, 'T2 bloqueado por defecto');

  -- ══ guardar como Dirección ═════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  r := public.cc_conocimiento_guardar(pA, 'resumen', 'Gel de ácido hialurónico para hidratación profunda de la piel.');
  d1 := (r ->> 'id')::uuid;
  perform tests.eq(r ->> 'estado', 'draft', 'B · se guarda como borrador');
  perform tests.eq((r ->> 'version')::int, 1, 'B · versión 1');
  perform tests.eq(r ->> 'nivel', 'T0', 'B · nivel derivado de la sección');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''resumen'', ''otro'')', pA), 'DRAFT_EXISTE', 'B · un solo borrador por sección');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''precio'', ''1000 pesos'')', pA), 'SECCION_INVALIDA', 'B · sección fuera de la lista cerrada');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''resumen'', %L)', pB, repeat('x', 4001)), 'ck_cpk_contenido', 'B · contenido acotado a 4000');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''composicion'', ''x'', null, null, ''public'')', pB), 'AUDIENCIA_INVALIDA', 'B · T1 no puede ser público');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''resumen'', ''x'')', gen_random_uuid()), 'PRODUCTO_INEXISTENTE', 'B · producto inexistente');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''resumen'', ''editado'', null, null, null, %L, 99)', pA, d1), 'REV_DESACTUALIZADA', 'C · rev desactualizada rechaza');
  r := public.cc_conocimiento_guardar(pA, 'resumen', 'Gel de ácido hialurónico reticulado para hidratación profunda.', null, null, null, d1, 1);
  perform tests.eq((r ->> 'rev')::int, 2, 'C · rev avanza al editar');

  -- ══ aprobar / versiones inmutables ═════════════════════════════════════════
  r := public.cc_conocimiento_aprobar(d1);
  perform tests.eq(r ->> 'estado', 'approved', 'D · aprobada');
  perform tests.eq((public.cc_conocimiento_aprobar(d1) ->> 'idempotente')::boolean, true, 'D · aprobar dos veces es idempotente');
  perform tests.throws(format('update public.cc_product_knowledge set contenido = ''hack'' where id = %L', d1), 'permission denied', 'D · Dirección no escribe la tabla directo');
  perform tests.act_as_service();
  perform tests.throws(format('update public.cc_product_knowledge set contenido = ''hack'' where id = %L', d1), 'CONOCIMIENTO_INMUTABLE', 'D · ni service_role edita una versión aprobada');
  perform tests.throws(format('delete from public.cc_product_knowledge where id = %L', d1), 'CONOCIMIENTO_INMUTABLE', 'D · las versiones no se borran');
  perform tests.act_as(v_admin);
  r := public.cc_conocimiento_guardar(pA, 'resumen', 'Gel de ácido hialurónico reticulado. Hidratación profunda y uniforme.');
  d2 := (r ->> 'id')::uuid;
  perform tests.eq((r ->> 'version')::int, 2, 'E · nueva versión = 2');
  select count(*) into n from public.cc_conocimiento_listar(pA) l where l.seccion = 'resumen' and l.estado = 'approved';
  perform tests.eq(n, 1, 'E · sigue vigente la v1 mientras v2 es borrador');
  perform tests.eq(public.cc_ficha_producto(pA) -> 'conocimiento' -> 'resumen' ->> 'contenido', 'Gel de ácido hialurónico reticulado para hidratación profunda.', 'E · la ficha sirve la aprobada, no el borrador');
  r := public.cc_conocimiento_aprobar(d2);
  perform tests.eq((r ->> 'retirada')::uuid, d1, 'E · aprobar v2 retira v1 en la misma transacción');
  select count(*) into n from public.cc_conocimiento_listar(pA) l where l.seccion = 'resumen' and l.estado = 'approved';
  perform tests.eq(n, 1, 'E · exactamente un approved por (producto, sección)');
  perform tests.eq((select l.estado from public.cc_conocimiento_listar(pA) l where l.id = d1), 'retired', 'E · v1 retirada');
  r := public.cc_conocimiento_restaurar(d1);
  perform tests.eq((r ->> 'version')::int, 3, 'F · restaurar crea v3 como borrador (no revive v1)');
  perform tests.eq((select l.estado from public.cc_conocimiento_listar(pA) l where l.id = d1), 'retired', 'F · v1 sigue retirada');
  perform tests.throws(format('select public.cc_conocimiento_restaurar(%L)', d2), 'ESTADO_INVALIDO', 'F · solo se restaura una retirada');
  r := public.cc_conocimiento_retirar(d2, 'texto desactualizado');
  perform tests.eq(r ->> 'estado', 'retired', 'G · retirar');
  perform tests.throws(format('select public.cc_conocimiento_retirar(%L, '''')', d2), 'MOTIVO_REQUERIDO', 'G · retirar exige motivo');
  perform tests.ok(public.cc_ficha_producto(pA) -> 'conocimiento' -> 'resumen' is null, 'G · sin approved, la ficha no muestra resumen');
  r := public.cc_conocimiento_aprobar((select l.id from public.cc_conocimiento_listar(pA) l where l.seccion = 'resumen' and l.estado = 'draft'));
  perform tests.eq(r ->> 'estado', 'approved', 'G · la v3 restaurada se aprueba');

  -- ══ T1 exige fuente; T2 bloqueado por defecto y con confirmación ════════════
  r := public.cc_conocimiento_guardar(pA, 'composicion', 'Ácido hialurónico reticulado 20 mg/ml.');
  perform tests.throws(format('select public.cc_conocimiento_aprobar(%L)', r ->> 'id'), 'FUENTE_REQUERIDA', 'H · T1 sin fuente no se aprueba');
  src := public.cc_fuente_registrar('ficha_tecnica', 'Ficha técnica Alfa', 'https://ejemplo.test/ficha-alfa.pdf', '2026-01');
  perform tests.eq(public.cc_fuente_registrar('ficha_tecnica', 'Ficha técnica Alfa', 'https://ejemplo.test/ficha-alfa.pdf', '2026-01'), src, 'H · registrar la misma fuente es idempotente');
  perform tests.throws('select public.cc_fuente_registrar(''ficha_tecnica'', ''x'', ''javascript:alert(1)'')', 'ck_cks_url', 'H · solo URLs http(s)');
  r := public.cc_conocimiento_guardar(pA, 'composicion', 'Ácido hialurónico reticulado 20 mg/ml.', null, src, null, (r ->> 'id')::uuid, 1);
  r := public.cc_conocimiento_aprobar((r ->> 'id')::uuid);
  perform tests.eq(r ->> 'estado', 'approved', 'H · T1 con fuente se aprueba');
  r := public.cc_conocimiento_guardar(pA, 'indicaciones', 'Indicado para pacientes con pérdida de volumen en surcos nasogenianos.', null, src);
  t2 := (r ->> 'id')::uuid;
  perform tests.throws(format('select public.cc_conocimiento_aprobar(%L, true)', t2), 'T2_BLOQUEADO', 'I · T2 no se aprueba con el interruptor apagado');
  perform tests.act_as(v_doc);
  perform tests.throws('select public.cc_config_t2(true)', 'NO_AUTORIZADO', 'I · un doctor no habilita T2');
  perform tests.act_as_service();
  perform tests.throws('select public.cc_config_t2(true)', 'NO_AUTORIZADO', 'I · ni service_role habilita T2 (solo Dirección)');
  perform tests.act_as(v_admin);
  perform tests.eq(public.cc_config_t2(true), true, 'I · Dirección habilita T2');
  perform tests.throws(format('select public.cc_conocimiento_aprobar(%L, false)', t2), 'T2_BLOQUEADO', 'I · habilitado, aún exige confirmación explícita');
  r := public.cc_conocimiento_aprobar(t2, true);
  perform tests.eq(r ->> 'estado', 'approved', 'I · T2 aprobado con interruptor + confirmación');
  perform tests.eq(public.cc_config_t2(false), false, 'I · Dirección vuelve a bloquear T2');
  perform tests.ok(public.cc_ficha_producto(pA, 'staff') -> 'conocimiento' -> 'indicaciones' is null, 'I · T2 aprobado pero bloqueado no se sirve ni a staff');
  perform tests.eq(public.cc_config_t2(true), true, 'I · (reactivado para el resto de la prueba)');
  perform tests.ok(public.cc_ficha_producto(pA, 'staff') -> 'conocimiento' -> 'indicaciones' is not null, 'I · con T2 habilitado se sirve a staff');

  -- ══ claims (capa secundaria) ═══════════════════════════════════════════════
  r := public.cc_conocimiento_guardar(pB, 'resumen', 'Relleno que cura las arrugas y garantiza resultados 100%.');
  perform tests.eq(jsonb_array_length(r -> 'claims'), 3, 'J · guardar devuelve los claims detectados (cura, garantiza, 100%)');
  perform tests.throws(format('select public.cc_conocimiento_aprobar(%L)', r ->> 'id'), 'CLAIM_PROHIBIDO', 'J · un claim prohibido no se aprueba');
  r := public.cc_conocimiento_guardar(pB, 'resumen', 'Relleno con dosis recomendada de 1 ml por sesión.', null, null, null, (r ->> 'id')::uuid, 1);
  perform tests.throws(format('select public.cc_conocimiento_aprobar(%L)', r ->> 'id'), 'CLAIM_REQUIERE_T2', 'J · lenguaje clínico en T0 se rechaza (va en T2)');
  r := public.cc_conocimiento_guardar(pB, 'resumen', 'Relleno de ácido hialurónico con efecto rejuvenecedor visible.', null, null, null, (r ->> 'id')::uuid, 2);
  r := public.cc_conocimiento_aprobar((r ->> 'id')::uuid);
  perform tests.eq(r ->> 'estado', 'approved', 'J · un disclaimer no bloquea');
  perform tests.ok(public.cc_ficha_producto(pB) -> 'disclaimers' @> '["Uso exclusivo por profesionales de la salud; no sustituye criterio clínico"]', 'J · la ficha expone el disclaimer aplicable');

  -- ══ alias (descubrimiento) y relaciones (curadas) ══════════════════════════
  al := public.cc_alias_guardar(pA, 'ALFA');
  perform tests.eq(public.cc_alias_guardar(pA, 'álfa '), al, 'K · alias se normaliza (acentos/mayúsculas/espacios) y es idempotente');
  perform tests.throws(format('select public.cc_alias_guardar(%L, ''alfa'')', pB), 'ALIAS_AMBIGUO', 'K · un alias no apunta a dos productos');
  perform tests.throws(format('select public.cc_alias_guardar(%L, ''a'')', pB), 'ALIAS_INVALIDO', 'K · alias de 1 carácter');
  r := public.cc_relacion_guardar(pA, pB, 'comparable');
  perform tests.eq(r ->> 'estado', 'draft', 'L · relación nace en borrador');
  perform tests.throws(format('select public.cc_relacion_guardar(%L, %L, ''reemplazo'', null, null, true)', pA, pC), 'FUENTE_REQUERIDA', 'L · reemplazo exige fuente para aprobarse');
  perform tests.throws(format('select public.cc_relacion_guardar(%L, %L, ''complemento'')', pA, pA), 'RELACION_INVALIDA', 'L · no consigo mismo');
  perform tests.throws(format('select public.cc_relacion_guardar(%L, %L, ''parecido'')', pA, pC), 'ck_cpr_tipo', 'L · tipo fuera de la lista');
  r := public.cc_relacion_guardar(pA, pB, 'comparable', null, null, true);
  perform tests.eq(r ->> 'estado', 'approved', 'L · comparable aprobada');
  perform tests.ok(public.cc_ficha_producto(pA) -> 'relaciones' @> jsonb_build_array(jsonb_build_object('tipo', 'comparable', 'product_id', pB)), 'L · la ficha expone la relación curada con su tipo');
  perform tests.ok(public.cc_ficha_producto(pB) -> 'relaciones' = '[]'::jsonb, 'L · la relación no se infiere a la inversa');
  perform tests.ok((public.cc_ficha_producto(pA) -> 'misma_familia') @> jsonb_build_array(jsonb_build_object('product_id', pB, 'nombre', 'Producto Beta 1 ml')), 'L · "misma familia" se DERIVA de products (no se copia)');
  perform tests.eq(public.cc_relacion_retirar((r ->> 'id')::uuid), true, 'L · retirar relación');
  perform tests.ok(public.cc_ficha_producto(pA) -> 'relaciones' = '[]'::jsonb, 'L · retirada ya no se sirve');

  -- ══ empresa ════════════════════════════════════════════════════════════════
  r := public.cc_empresa_guardar('como_comprar', 'Cómo comprar', 'Los doctores verificados compran desde el portal; el pago se valida antes del envío.');
  emp := (r ->> 'id')::uuid;
  perform tests.throws('select public.cc_empresa_guardar(''chismes'', ''x'', ''y'')', 'ck_cck_tema', 'M · tema fuera de la lista');
  r := public.cc_empresa_aprobar(emp);
  perform tests.eq(r ->> 'estado', 'approved', 'M · empresa aprobada');
  perform tests.act_as_service();
  perform tests.throws(format('update public.cc_company_knowledge set contenido = ''x'' where id = %L', emp), 'CONOCIMIENTO_INMUTABLE', 'M · empresa aprobada inmutable');
  perform tests.act_as(v_admin);

  -- ══ bitácora append-only ═══════════════════════════════════════════════════
  select count(*) into n from public.cc_knowledge_events;
  perform tests.ok(n - ev >= 25, 'N · cada acción deja evento (' || (n - ev) || ')');
  perform tests.ok(exists (select 1 from public.cc_knowledge_events e where e.entidad = 'producto' and e.entidad_id = d2 and e.accion = 'retirar' and e.actor_profile_id = v_admin), 'N · el evento registra actor y acción');
  perform tests.ok(exists (select 1 from public.cc_knowledge_events e where e.entidad = 'config' and e.accion = 'configurar'), 'N · habilitar T2 queda en bitácora');
  perform tests.act_as_service();
  perform tests.throws('delete from public.cc_knowledge_events', 'APPEND_ONLY', 'N · bitácora no se borra');
  perform tests.throws('update public.cc_knowledge_events set accion = ''crear''', 'APPEND_ONLY', 'N · bitácora no se edita');
  perform tests.act_as(v_admin);
  perform tests.lives('select count(*) from public.cc_knowledge_events', 'N · Dirección lee la bitácora');

  -- ══ importación del conocimiento existente: SOLO borradores, idempotente ═══
  imp := public.cc_importar_conocimiento_existente();
  perform tests.ok((imp ->> 'presentacion')::int >= 2, 'O · odoo_reference → presentación (' || (imp ->> 'presentacion') || ')');
  perform tests.ok((imp ->> 'caracteristicas')::int >= 1 and (imp ->> 'ficha_tecnica')::int >= 1, 'O · chips → características, folleto → ficha técnica con fuente');
  perform tests.eq((imp ->> 'resumen')::int, 0, 'O · no pisa secciones que ya tienen versión (resumen de A ya existía)');
  perform tests.eq((select count(*) from public.cc_conocimiento_listar(pA) l where l.importado_de is not null and l.importado_de not like 'restaurado:%' and l.estado <> 'draft'), 0::bigint, 'O · NADA importado queda aprobado');
  perform tests.eq((select l.fuente from public.cc_conocimiento_listar(pA) l where l.seccion = 'ficha_tecnica'), 'catalogo_oficial · Folleto · ' || (select sku from public.products where id = pA), 'O · la ficha importada lleva procedencia');
  imp := public.cc_importar_conocimiento_existente();
  perform tests.eq((imp ->> 'presentacion')::int + (imp ->> 'caracteristicas')::int + (imp ->> 'ficha_tecnica')::int, 0, 'O · segunda corrida no duplica (idempotente)');
  perform tests.ok(public.cc_ficha_producto(pA) -> 'conocimiento' -> 'presentacion' is null, 'O · lo importado no se sirve hasta aprobarse');
  perform tests.ok((select array_length(c.faltantes_t0, 1) from public.cc_cobertura() c where c.product_id = pB) >= 3 and (select c.borradores from public.cc_cobertura() c where c.product_id = pB) @> array['presentacion'], 'P · cobertura distingue aprobadas, borradores y faltantes');
end $t$;
rollback;
