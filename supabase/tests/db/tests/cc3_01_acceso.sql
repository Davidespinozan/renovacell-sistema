-- CC-3 · Acceso: la audiencia la decide el servidor (anon/registrado=public, verificado y
-- personal=verified, Dirección=staff; service_role puede pedirla), T1 no sale a público, T2 solo
-- con el interruptor, nada de precio/stock/costo/fiscal/metadata cruda en ninguna lectura, los
-- clientes no tocan tablas ni comandos de administración, productos ocultos no existen para la
-- audiencia, los campos STAFF_ONLY (notas de fuente) no se filtran.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); v_pos uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  pA uuid; pOculto uuid; pPortal uuid; src uuid; r jsonb; f jsonb; txt text; k uuid;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  pA := tests.producto_fam('Bioestimuladores', 'Familia Y'); pOculto := tests.producto_cat('Rellenos'); pPortal := tests.producto_cat('Rellenos');
  update public.products set name = 'Producto Gamma', metadata = '{"tagline":"Volumen natural","chips":["AH"],"interno":"secreto"}'::jsonb, price = 98765.43 where id = pA;
  insert into public.product_costs (product_id, unit_cost) values (pA, 54321.87) on conflict (product_id) do nothing;
  update public.products set name = 'Producto Oculto', show_landing = false, show_portal = false where id = pOculto;
  update public.products set name = 'Producto Solo Portal', show_landing = false, show_portal = true where id = pPortal;
  perform tests.act_as(v_admin);
  src := public.cc_fuente_registrar('fabricante', 'Fabricante Gamma', 'https://ejemplo.test/gamma', null, 'NOTA INTERNA: contacto comercial');
  k := (public.cc_conocimiento_guardar(pA, 'resumen', 'Bioestimulador de colágeno de liberación gradual.') ->> 'id')::uuid; perform public.cc_conocimiento_aprobar(k);
  k := (public.cc_conocimiento_guardar(pA, 'composicion', 'Policaprolactona en gel portador de CMC.', null, src) ->> 'id')::uuid; perform public.cc_conocimiento_aprobar(k);
  k := (public.cc_conocimiento_guardar(pA, 'protocolo', 'Protocolo de aplicación en 2 sesiones.', null, src) ->> 'id')::uuid;
  perform public.cc_config_t2(true); perform public.cc_conocimiento_aprobar(k, true); perform public.cc_config_t2(false);
  k := (public.cc_conocimiento_guardar(pPortal, 'resumen', 'Solo para el portal.') ->> 'id')::uuid; perform public.cc_conocimiento_aprobar(k);
  k := (public.cc_conocimiento_guardar(pOculto, 'resumen', 'Nadie debería ver esto.') ->> 'id')::uuid; perform public.cc_conocimiento_aprobar(k);

  -- ══ audiencia derivada ══════════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.eq(public.cc_audiencia_actual(), 'public', 'Q · anon = public');
  perform tests.eq(public.cc_ficha_producto(pA, 'staff') ->> 'audiencia', 'public', 'Q · anon NO puede pedir staff (se ignora)');
  perform tests.throws('select public._cc_audiencia(''staff'')', 'permission denied', 'Q · el helper interno no es invocable por clientes');
  perform tests.act_as(v_nov);
  perform tests.eq(public.cc_audiencia_actual(), 'public', 'Q · doctor sin verificar = public');
  perform tests.act_as(v_doc);
  perform tests.eq(public.cc_audiencia_actual(), 'verified', 'Q · doctor verificado = verified');
  perform tests.eq(public.cc_ficha_producto(pA, 'staff') ->> 'audiencia', 'verified', 'Q · un doctor no escala a staff pidiéndolo');
  perform tests.act_as(v_pos); perform tests.eq(public.cc_audiencia_actual(), 'verified', 'Q · personal = verified');
  perform tests.act_as(v_wh); perform tests.eq(public.cc_audiencia_actual(), 'verified', 'Q · almacén = verified');
  perform tests.act_as(v_admin); perform tests.eq(public.cc_audiencia_actual(), 'staff', 'Q · Dirección = staff');
  perform tests.act_as_service();
  perform tests.eq(public._cc_audiencia('verified'), 'verified', 'Q · service_role (Edge) puede fijar la audiencia resuelta');
  perform tests.eq(public._cc_audiencia(null), 'public', 'Q · service_role sin audiencia = public (fail-closed)');
  perform tests.eq(public._cc_audiencia('root'), 'public', 'Q · audiencia desconocida = public');

  -- ══ T1/T2 por audiencia; T2 por interruptor ═════════════════════════════════
  perform tests.act_as_anon();
  f := public.cc_ficha_producto(pA);
  perform tests.ok(f -> 'conocimiento' ? 'resumen' and not (f -> 'conocimiento' ? 'composicion') and not (f -> 'conocimiento' ? 'protocolo'), 'R · público: T0 sí, T1/T2 no');
  perform tests.eq(f -> 'niveles_disponibles', '["T0"]'::jsonb, 'R · niveles disponibles al público = T0');
  perform tests.act_as(v_nov);
  perform tests.ok(not (public.cc_ficha_producto(pA) -> 'conocimiento' ? 'composicion'), 'R · doctor sin verificar no ve T1');
  perform tests.act_as(v_doc);
  f := public.cc_ficha_producto(pA);
  perform tests.ok(f -> 'conocimiento' ? 'composicion' and not (f -> 'conocimiento' ? 'protocolo'), 'R · verificado: T1 sí, T2 no (bloqueado)');
  perform tests.eq(f -> 'conocimiento' -> 'composicion' -> 'fuente' ->> 'tipo', 'fabricante', 'R · la ficha cita la fuente del T1');
  perform tests.ok(f::text not like '%NOTA INTERNA%', 'R · las notas de la fuente (STAFF_ONLY) no salen');
  perform tests.act_as(v_admin);
  perform public.cc_config_t2(true);
  perform tests.act_as(v_doc);
  perform tests.ok(public.cc_ficha_producto(pA) -> 'conocimiento' ? 'protocolo', 'R · T2 habilitado: verificado lo ve');
  perform tests.act_as_anon();
  perform tests.ok(not (public.cc_ficha_producto(pA) -> 'conocimiento' ? 'protocolo'), 'R · T2 habilitado: público sigue sin verlo');
  perform tests.ok(not exists (select 1 from public.cc_buscar_conocimiento('protocolo aplicación') b), 'R · la búsqueda tampoco filtra T2 al público');
  perform tests.act_as(v_doc);
  perform tests.ok(exists (select 1 from public.cc_buscar_conocimiento('protocolo aplicación') b where b.nivel = 'T2'), 'R · búsqueda T2 a verificado con interruptor');

  -- ══ nada de precio/stock/costo/fiscal/metadata cruda ════════════════════════
  perform tests.act_as(v_admin);
  txt := public.cc_ficha_producto(pA)::text || public.cc_catalogo_para_ia()::text || public.cc_comparar_productos(array[pA, pPortal])::text
       || coalesce((select jsonb_agg(to_jsonb(b)) from public.cc_buscar_productos('gamma') b)::text, '') || coalesce((select jsonb_agg(to_jsonb(c)) from public.cc_candidatos_recomendacion('Bioestimuladores') c)::text, '');
  perform tests.ok(txt not like '%98765.43%' and txt not like '%54321.87%' and txt not ilike '%"price"%' and txt not ilike '%"cost"%' and txt not ilike '%stock%' and txt not ilike '%sat_%' and txt not like '%secreto%' and txt not like '%"interno"%',
                   'S · ninguna lectura (ni para staff) expone precio, costo, stock, fiscal ni metadata cruda');
  perform tests.ok(txt not ilike '%odoo_identity%' and txt not ilike '%import_hash%', 'S · sin claves SYSTEM_ONLY');
  perform tests.ok(public.cc_ficha_producto(pA) ? 'tagline' and public.cc_ficha_producto(pA) ? 'presentacion', 'S · identidad pública sí (tagline, presentación)');

  -- ══ visibilidad por canal ═══════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.ok(public.cc_ficha_producto(pOculto) is null and public.cc_ficha_producto(pPortal) is null, 'T · público: ocultos y solo-portal no existen (null, sin revelar)');
  perform tests.ok(public.cc_ficha_producto(gen_random_uuid()) is null, 'T · inexistente = null');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('oculto') b) and not exists (select 1 from public.cc_buscar_productos('solo portal') b), 'T · búsqueda pública no los lista');
  perform tests.ok(not exists (select 1 from public.cc_buscar_conocimiento('nadie debería') b), 'T · conocimiento de un oculto no aparece en búsqueda pública');
  perform tests.act_as(v_doc);
  perform tests.ok(public.cc_ficha_producto(pPortal) is not null and public.cc_ficha_producto(pOculto) is null, 'T · verificado: solo-portal sí, oculto no');
  perform tests.ok(jsonb_array_length(public.cc_comparar_productos(array[pA, pOculto]) -> 'productos') = 1, 'T · comparar omite lo no visible');

  -- ══ clientes no tocan tablas ni comandos ═════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.cc_product_knowledge', 'permission denied', 'U · anon no lee la tabla');
  perform tests.throws('select count(*) from public.cc_knowledge_sources', 'permission denied', 'U · anon no lee fuentes');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''resumen'', ''x'')', pA), 'permission denied', 'U · anon no guarda');
  perform tests.throws('select * from public.cc_cobertura()', 'permission denied', 'U · anon no ve cobertura');
  perform tests.throws('select public.cc_importar_conocimiento_existente()', 'permission denied', 'U · anon no importa');
  perform tests.act_as(v_doc);
  perform tests.throws('select count(*) from public.cc_product_knowledge', 'permission denied', 'U · doctor no lee la tabla');
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''resumen'', ''x'')', pA), 'NO_AUTORIZADO', 'U · doctor no guarda');
  perform tests.throws(format('select public.cc_conocimiento_aprobar(%L)', k), 'NO_AUTORIZADO', 'U · doctor no aprueba');
  perform tests.throws('select public.cc_fuente_registrar(''fabricante'', ''x'')', 'NO_AUTORIZADO', 'U · doctor no registra fuentes');
  perform tests.throws(format('select public.cc_alias_guardar(%L, ''gamma'')', pA), 'NO_AUTORIZADO', 'U · doctor no crea alias');
  perform tests.throws('select public.cc_importar_conocimiento_existente()', 'NO_AUTORIZADO', 'U · doctor no importa');
  perform tests.ok((select count(*) from public.cc_cobertura()) = 0 and (select count(*) from public.cc_fuentes_listar()) = 0 and (select count(*) from public.cc_conocimiento_listar(pA)) = 0, 'U · listados administrativos vacíos para doctor');
  perform tests.eq((select count(*) from public.cc_knowledge_events), 0::bigint, 'U · la bitácora está vacía para un doctor (RLS: solo Dirección)');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.cc_conocimiento_guardar(%L, ''resumen'', ''x'')', pA), 'NO_AUTORIZADO', 'U · vendedor no guarda conocimiento');
  perform tests.act_as(v_admin);
  perform tests.throws('insert into public.cc_claim_rules (patron, tipo, motivo) values (''x'', ''prohibido'', ''y'')', 'permission denied', 'U · Dirección tampoco escribe tablas directo');
  perform tests.ok((select count(*) from public.cc_fuentes_listar() f where f.notas like 'NOTA INTERNA%') = 1, 'U · Dirección sí ve las notas internas de la fuente');
end $t$;
rollback;
