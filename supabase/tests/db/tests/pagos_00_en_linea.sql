-- PAGOS EN LÍNEA · nace apagado; cualquiera con sesión lo lee; solo Dirección lo cambia y queda en la bitácora; nadie lee
-- ni escribe las tablas directo.
begin;
do $t$
declare v_adm uuid := tests.user('admin'); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor'); r jsonb;
begin
  perform tests.act_as(v_doc);
  perform tests.ok((public.pagos_config_ver() ->> 'tarjeta_en_linea')::boolean = false, '1 · nace apagado y el doctor lo puede leer');
  perform tests.throws('select public.pagos_config_guardar(true)', 'NO_AUTORIZADO', '2 · el doctor no lo cambia');
  perform tests.throws('select * from public.pagos_config', 'permission denied', '3 · ni lee la tabla');
  perform tests.act_as(v_pos);
  perform tests.throws('select public.pagos_config_guardar(true)', 'NO_AUTORIZADO', '4 · Ventas tampoco lo cambia');
  perform tests.act_as(v_adm);
  r := public.pagos_config_guardar(true);
  perform tests.ok((r ->> 'tarjeta_en_linea')::boolean, '5 · Dirección lo enciende');
  r := public.pagos_config_guardar(true);
  r := public.pagos_config_guardar(false);
  perform tests.ok(not (r ->> 'tarjeta_en_linea')::boolean, '6 · y lo apaga');
  perform tests.throws('update public.pagos_config set tarjeta_en_linea = true', 'permission denied', '7 · ni Dirección escribe la tabla directo');
  perform tests.act_as_anon();
  perform tests.throws('select public.pagos_config_ver()', 'permission denied', '8 · sin sesión no se lee');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.pagos_config_hist), 2, '9 · la bitácora guarda 2 cambios (repetir el mismo valor no cuenta)');
  perform tests.ok((select actor = v_adm from public.pagos_config_hist order by id desc limit 1), '10 · con quién lo cambió');
end $t$;
rollback;
