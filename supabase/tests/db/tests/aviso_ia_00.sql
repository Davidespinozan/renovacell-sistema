-- AVISO-IA · solo Dirección guarda/quita el aviso del asistente; valida largo y fecha; deja bitácora; quitarlo borra la fecha.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); d uuid := tests.user('doctor'); r jsonb;
begin
  perform tests.act_as(v_pos);
  perform tests.throws('select public.ia_aviso_guardar(''La sucursal está cerrada'', null)', 'NO_AUTORIZADO', '1 · un vendedor no lo cambia');
  perform tests.act_as(d);
  perform tests.throws('select public.ia_aviso_guardar(''La sucursal está cerrada'', null)', 'NO_AUTORIZADO', '1 · un doctor tampoco');
  perform tests.act_as(v_admin);
  perform tests.throws('select public.ia_aviso_guardar(''Ok'', null)', 'AVISO_CORTO', '2 · muy corto');
  perform tests.throws(format('select public.ia_aviso_guardar(%L, null)', repeat('x', 1001)), 'AVISO_LARGO', '2 · muy largo');
  perform tests.throws('select public.ia_aviso_guardar(''La sucursal está cerrada'', current_date - 2)', 'FECHA_PASADA', '2 · fecha pasada');
  r := public.ia_aviso_guardar('  La sucursal está cerrada por remodelación.  ', current_date + 10);
  perform tests.ok(r ->> 'texto' = 'La sucursal está cerrada por remodelación.' and (r ->> 'hasta')::date = current_date + 10, '3 · guardado (sin espacios) con fecha');
  perform tests.act_as_owner();
  perform tests.ok((select aviso_ia = 'La sucursal está cerrada por remodelación.' from public.company_settings where id = 'default'), '3 · queda en la empresa');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Aviso del asistente'), '3 · bitácora');
  perform tests.act_as(v_admin);
  r := public.ia_aviso_guardar(null, current_date + 5);
  perform tests.ok(r ->> 'texto' is null and r ->> 'hasta' is null, '4 · quitar borra texto y fecha');
  perform tests.act_as_owner();
end $t$;
rollback;
