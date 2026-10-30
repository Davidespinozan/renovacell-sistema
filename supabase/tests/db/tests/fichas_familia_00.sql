-- FICHAS POR FAMILIA (20270225) · la presentación hereda la ficha aprobada de su familia (lo propio manda) y Dirección
-- aprueba una ficha completa en un paso con las mismas reglas (fuente para T1, T2 bloqueado sin habilitación).
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); pPadre uuid; pV uuid; v_src uuid; r jsonb;
begin
  perform tests.act_as_service();
  pPadre := tests.producto_fam('Péptidos', 'Hidrolizados'); pV := tests.producto_fam('Péptidos', 'Hidrolizados');
  update public.products set name = 'Hidrolizados', sellable = false, show_portal = true where id = pPadre;
  update public.products set name = 'HIDROLIZADO vial 8 ml BAZO', parent_product_id = pPadre, show_portal = true where id = pV;
  perform tests.act_as(v_admin);
  v_src := public.cc_fuente_registrar('renovacell', 'Folleto Hidrolizados', 'https://www.goldenplacenta.com/web/content/1');
  perform public.cc_conocimiento_guardar(pPadre, 'resumen', 'Hidrolizado cosmético de órganos en vial de 8 ml.');
  perform public.cc_conocimiento_guardar(pPadre, 'composicion', 'Péptidos de bajo peso molecular.', null, v_src);
  perform public.cc_conocimiento_guardar(pPadre, 'presentacion', 'Sin fuente aún.');
  perform public.cc_conocimiento_guardar(pPadre, 'concentracion', 'Dato técnico sin fuente.');
  perform public.cc_conocimiento_guardar(pPadre, 'indicaciones', 'Uso según criterio médico.', null, v_src);

  -- ══ 1 · aprobar la ficha completa en un paso, con las mismas reglas ══
  r := public.cc_conocimiento_aprobar_ficha(pPadre);
  perform tests.ok((r ->> 'aprobadas')::int = 3
    and exists (select 1 from jsonb_array_elements(r -> 'pendientes') e where e ->> 'seccion' = 'concentracion' and e ->> 'motivo' = 'FUENTE_REQUERIDA')
    and exists (select 1 from jsonb_array_elements(r -> 'pendientes') e where e ->> 'seccion' = 'indicaciones' and e ->> 'motivo' = 'T2_BLOQUEADO'), '1 · aprueba lo que pasa; lo técnico sin fuente y lo clínico quedan pendientes con su motivo');

  -- ══ 2 · la presentación hereda; lo propio manda ══
  perform tests.act_as(v_doc);
  r := public.cc_ficha_producto(pV);
  perform tests.ok(r -> 'conocimiento' -> 'resumen' ->> 'contenido' like 'Hidrolizado cosmético%' and (r -> 'conocimiento' -> 'resumen' ->> 'de_la_familia')::boolean
    and r -> 'conocimiento' -> 'composicion' ->> 'contenido' = 'Péptidos de bajo peso molecular.', '2 · la presentación ve la ficha de su familia');
  perform tests.act_as(v_admin);
  perform public.cc_conocimiento_aprobar((public.cc_conocimiento_guardar(pV, 'resumen', 'Hidrolizado de bazo.') ->> 'id')::uuid);
  perform tests.act_as(v_doc);
  r := public.cc_ficha_producto(pV);
  perform tests.ok(r -> 'conocimiento' -> 'resumen' ->> 'contenido' = 'Hidrolizado de bazo.' and r -> 'conocimiento' -> 'resumen' -> 'de_la_familia' is null, '2 · lo propio de la presentación manda sobre lo heredado');
  perform tests.ok(r -> 'conocimiento' -> 'indicaciones' is null, '2 · lo no aprobado no se hereda');

  -- ══ 3 · solo Dirección ══
  perform tests.throws(format('select public.cc_conocimiento_aprobar_ficha(%L)', pPadre), 'NO_AUTORIZADO', '3 · un doctor no aprueba');
end $t$;
rollback;
