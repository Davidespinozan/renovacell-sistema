-- CC-3 · Búsqueda determinista (sku → alias → nombre → familia → contiene → texto aprobado),
-- normalización de acentos, candidatos de recomendación acotados a lo visible y vendible,
-- catálogo para la IA y comparación.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor');
  pA uuid; pB uuid; pC uuid; pD uuid; pPadre uuid; k uuid; r jsonb; n int;
begin
  perform tests.act_as_service();
  pA := tests.producto_fam('Rellenos', 'Hyalux'); pB := tests.producto_fam('Rellenos', 'Hyalux'); pC := tests.producto_fam('Bioestimuladores', 'Colagex'); pD := tests.producto_cat('Mesoterapia');
  pPadre := tests.producto_fam('Rellenos', 'Hyalux');
  update public.products set name = 'Hyalux Deep 1 ml', sku = 'HX-DEEP-1', odoo_reference = '1 jeringa 1 ml' where id = pA;
  update public.products set name = 'Hyalux Lips 1 ml', sku = 'HX-LIPS-1', parent_product_id = pPadre where id = pB;
  update public.products set name = 'Hyalux', sku = 'HX-FAM', sellable = false where id = pPadre;
  update public.products set name = 'Colagex Plus', sku = 'CX-PLUS' where id = pC;
  update public.products set name = 'Mesovit Cóctel Vitamínico', sku = 'MV-01', sellable = false where id = pD;
  perform tests.act_as(v_admin);
  k := (public.cc_conocimiento_guardar(pA, 'caracteristicas', 'Ácido hialurónico reticulado para surcos profundos y pómulos.') ->> 'id')::uuid; perform public.cc_conocimiento_aprobar(k);
  k := (public.cc_conocimiento_guardar(pB, 'caracteristicas', 'Ácido hialurónico suave para labios.') ->> 'id')::uuid; perform public.cc_conocimiento_aprobar(k);
  k := (public.cc_conocimiento_guardar(pC, 'uso_comercial', 'Bioestimulador de colágeno para flacidez facial.') ->> 'id')::uuid; perform public.cc_conocimiento_aprobar(k);
  k := (public.cc_conocimiento_guardar(pC, 'resumen', 'Borrador no aprobado con la palabra pómulos.') ->> 'id')::uuid;   -- queda draft
  perform public.cc_alias_guardar(pA, 'deep');
  perform public.cc_alias_guardar(pC, 'colágeno plus', 'nombre_comercial');
  perform public.cc_empresa_aprobar((public.cc_empresa_guardar('envios', 'Envíos a todo México', 'Enviamos a toda la república con paquetería refrigerada cuando el producto lo requiere.') ->> 'id')::uuid);

  -- ══ búsqueda determinista ═══════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.eq((select b.product_id from public.cc_buscar_productos('hx-deep-1') b limit 1), pA, 'V · sku exacto (insensible a mayúsculas) gana');
  perform tests.eq((select b.coincidencia from public.cc_buscar_productos('HX-DEEP-1') b limit 1), 'sku', 'V · vía = sku');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('DEEP') b limit 1), pA, 'V · alias exacto');
  perform tests.eq((select b.coincidencia from public.cc_buscar_productos('colageno plus') b limit 1), 'alias', 'V · alias sin acento coincide con "colágeno plus"');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('hyalux deep 1 ml') b limit 1), pA, 'V · nombre exacto');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('hyalux') b limit 1), pPadre, 'V · "hyalux" → primero la familia (padre), luego variantes');
  select count(*) into n from public.cc_buscar_productos('hyalux') b;
  perform tests.eq(n, 3, 'V · la familia trae a sus 3 miembros');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('pómulos') b limit 1), pA, 'V · texto aprobado (FTS) encuentra por característica');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('pómulos') b where b.product_id = pC), 'V · un borrador NO es buscable');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('x') b), 'V · una letra no busca');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('zzzz inexistente') b), 'V · sin coincidencias = vacío (no inventa)');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('MESOVIT COCTEL') b limit 1), pD, 'V · "cóctel" ↔ "coctel" (normalización)');
  perform tests.ok((select count(*) from public.cc_buscar_productos('hyalux', 2) b) = 2, 'V · límite respetado');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('''; drop table products; --') b), 'V · texto hostil = sin resultados, sin error');

  -- ══ búsqueda en conocimiento ════════════════════════════════════════════════
  perform tests.ok(exists (select 1 from public.cc_buscar_conocimiento('labios') b where b.product_id = pB and b.seccion = 'caracteristicas'), 'W · conocimiento aprobado por sección');
  perform tests.ok(exists (select 1 from public.cc_buscar_conocimiento('paquetería refrigerada') b where b.entidad = 'empresa' and b.seccion = 'envios'), 'W · conocimiento de empresa también');
  perform tests.ok((select b.fragmento from public.cc_buscar_conocimiento('labios') b limit 1) ilike '%<b>labios</b>%', 'W · fragmento resaltado');
  perform tests.ok(not exists (select 1 from public.cc_buscar_conocimiento('borrador') b), 'W · borradores no se buscan');

  -- ══ candidatos de recomendación ═════════════════════════════════════════════
  perform tests.ok((select array_agg(c.product_id) from public.cc_candidatos_recomendacion('Rellenos') c) @> array[pA, pB] and not ((select array_agg(c.product_id) from public.cc_candidatos_recomendacion('Rellenos') c) @> array[pPadre]), 'X · por categoría: solo vendibles (el padre no)');
  perform tests.ok(not exists (select 1 from public.cc_candidatos_recomendacion('Mesoterapia') c), 'X · no vendible no se recomienda');
  perform tests.eq((select c.product_id from public.cc_candidatos_recomendacion(null, null, array['flacidez']) c), pC, 'X · por término en secciones aprobadas');
  perform tests.eq((select c.motivo from public.cc_candidatos_recomendacion('Rellenos', 'Hyalux', array['labios']) c where c.product_id = pB), 'caracteristica+categoria+familia', 'X · el motivo explica por qué es candidato');
  perform tests.ok(not exists (select 1 from public.cc_candidatos_recomendacion(null, null, array['pómulos']) c where c.product_id = pC), 'X · un borrador no hace candidato');
  perform tests.ok(not exists (select 1 from public.cc_candidatos_recomendacion() c), 'X · sin criterios no devuelve nada (la IA no recibe "todo")');

  -- ══ catálogo para la IA y comparación ═══════════════════════════════════════
  r := public.cc_catalogo_para_ia();
  perform tests.ok(jsonb_array_length(r) >= 5, 'Y · catálogo compacto');
  perform tests.ok(r::text not ilike '%price%' and r::text not ilike '%stock%', 'Y · sin precio ni stock');
  perform tests.eq((select e ->> 'resumen' from jsonb_array_elements(r) e where (e ->> 'product_id')::uuid = pC), null, 'Y · resumen solo si está aprobado (el de C es borrador)');
  r := public.cc_comparar_productos(array[pA, pB]);
  perform tests.eq(jsonb_array_length(r -> 'productos'), 2, 'Z · comparar devuelve las fichas');
  perform tests.eq((r ->> 'comparacion_curada')::boolean, false, 'Z · sin relación "comparable" aprobada, la comparación NO está curada');
  perform tests.eq((r ->> 'misma_familia')::boolean, true, 'Z · misma familia derivada');
  perform tests.throws(format('select public.cc_comparar_productos(array[%L]::uuid[])', pA), 'COMPARACION_INVALIDA', 'Z · mínimo 2');
  perform tests.throws(format('select public.cc_comparar_productos(array[%L,%L,%L,%L,%L]::uuid[])', pA, pB, pC, pD, pPadre), 'COMPARACION_INVALIDA', 'Z · máximo 4');
  perform tests.act_as(v_admin);
  perform public.cc_relacion_guardar(pA, pB, 'comparable', null, null, true);
  perform tests.act_as_anon();
  perform tests.eq((public.cc_comparar_productos(array[pA, pB]) ->> 'comparacion_curada')::boolean, true, 'Z · con relación aprobada, comparación curada');
end $t$;
rollback;
