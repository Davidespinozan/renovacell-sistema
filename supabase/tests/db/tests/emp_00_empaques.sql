-- EMP-1 (172) · catálogo de empaques: semilla del dueño (13), la más usada primero, solo personal lo lee, solo Dirección o
-- Almacén lo editan; una sola "frecuente"; nombres únicos; desactivar no borra; bitácora.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor'); l jsonb; r jsonb; n int; id uuid;
begin
  perform tests.act_as_anon();
  perform tests.throws('select public.empaques_lista()', 'permission denied', '1 · anónimo no lee el catálogo');
  perform tests.act_as(v_doc);
  perform tests.eq(jsonb_array_length(public.empaques_lista()), 0, '2 · el doctor no ve empaques');
  perform tests.act_as(v_pos);
  l := public.empaques_lista();
  perform tests.ok(jsonb_array_length(l) = 13 and l -> 0 ->> 'nombre' = 'Hielera chica #4' and (l -> 0 ->> 'frecuente')::boolean and (l -> 0 ->> 'largo_cm')::numeric = 20 and (l -> 0 ->> 'alto_cm')::numeric = 22, '3 · 13 empaques; la más usada primero con sus medidas');
  perform tests.ok((select count(*) from jsonb_array_elements(l) x where x ->> 'tipo' = 'hielera') = 7 and (select count(*) from jsonb_array_elements(l) x where x ->> 'tipo' = 'caja') = 6, '3 · 7 hieleras y 6 cajas');
  perform tests.throws('select public.empaque_guardar(''{"nombre":"X","largo_cm":1,"ancho_cm":1,"alto_cm":1}'')', 'NO_AUTORIZADO', '4 · Ventas no edita el catálogo');
  perform tests.act_as(v_wh);
  r := public.empaque_guardar('{"nombre":"Hielera prueba","tipo":"hielera","largo_cm":10,"ancho_cm":11,"alto_cm":12,"peso_kg":0.4,"frecuente":true}'::jsonb);
  id := (r ->> 'id')::uuid;
  perform tests.ok((r ->> 'frecuente')::boolean and (r ->> 'peso_kg')::numeric = 0.4, '5 · Almacén agrega un empaque y lo marca como el más usado');
  perform tests.ok((public.empaques_lista() -> 0 ->> 'id')::uuid = id and (select count(*) from jsonb_array_elements(public.empaques_lista(true)) x where (x ->> 'frecuente')::boolean) = 1, '5 · una sola "frecuente": la anterior deja de serlo y la nueva va primero');
  perform tests.throws('select public.empaque_guardar(''{"nombre":"hielera PRUEBA","largo_cm":1,"ancho_cm":1,"alto_cm":1}'')', 'duplicate key', '6 · nombres únicos (sin distinguir mayúsculas)');
  perform tests.throws('select public.empaque_guardar(''{"nombre":"Rara","largo_cm":0,"ancho_cm":1,"alto_cm":1}'')', 'violates check constraint', '6 · medidas válidas');
  perform tests.throws('select public.empaque_guardar(''{"nombre":"Rara","tipo":"bolsa","largo_cm":1,"ancho_cm":1,"alto_cm":1}'')', 'violates check constraint', '6 · tipo hielera o caja');
  perform tests.act_as(v_admin);
  r := public.empaque_guardar(jsonb_build_object('id', id, 'activo', false, 'nota', 'ya no se usa'));
  perform tests.ok(not (r ->> 'activo')::boolean and r ->> 'nota' = 'ya no se usa' and r ->> 'nombre' = 'Hielera prueba', '7 · Dirección desactiva sin borrar (y conserva lo demás)');
  perform tests.eq(jsonb_array_length(public.empaques_lista()), 13, '7 · la lista normal no lo muestra');
  perform tests.eq(jsonb_array_length(public.empaques_lista(true)), 14, '7 · con p_todos sí (para administrarlo)');
  perform tests.throws(format('select public.empaque_guardar(''{"id":"%s","nombre":"x","largo_cm":1,"ancho_cm":1,"alto_cm":1}'')', gen_random_uuid()), 'EMPAQUE_INEXISTENTE', '8 · editar uno que no existe');
  perform tests.throws('insert into public.empaques (nombre, largo_cm, ancho_cm, alto_cm) values (''directo'', 1, 1, 1)', 'permission denied', '9 · sin escritura directa');
  perform tests.throws('select count(*) from public.empaques', 'permission denied', '9 · ni lectura directa (solo por la función)');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Empaque guardado' and resource_id = 'Hielera prueba'), '10 · queda en la bitácora');
  perform tests.act_as_owner();
end $t$;
rollback;
