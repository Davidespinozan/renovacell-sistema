-- W5 · AUTORIDAD. Ventas y cobranza: Dirección y Facturación. Costo y utilidad: SOLO Dirección.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doc uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_comm uuid := tests.user('comm');
  r record; f text;
begin
  -- Ni doctor, ni almacén, ni ventas/POS, ni comunicación ven indicador alguno.
  for r in select * from (values (v_doc, 'doctor'), (v_wh, 'almacén'), (v_pos, 'ventas/POS'), (v_comm, 'comunicación')) t(uid, nombre) loop
    perform tests.act_as(r.uid);
    foreach f in array array['select public.kpi_ventas()', 'select public.kpi_ventas(''2026-01-01'', ''2026-01-31'')',
                             'select public.kpi_por_cobrar()', 'select public.kpi_resultado()',
                             'select public.kpi_resultado(''2026-01-01'', ''2026-01-31'')'] loop
      perform tests.throws(f, 'NO_AUTORIZADO', r.nombre || ' no consulta ' || split_part(split_part(f, 'public.', 2), '(', 1));
    end loop;
    perform tests.throws('select * from public._kpi_ventas(null, null)', 'permission denied',
      r.nombre || ' no ejecuta el interno _kpi_ventas');
  end loop;

  -- Facturación opera la cobranza: ve ventas y por cobrar. Costo y utilidad, NO.
  perform tests.act_as(v_bill);
  perform tests.ok(public.kpi_ventas() ? 'cobrado_neto', 'Facturación consulta ventas y cobranza');
  perform tests.ok(public.kpi_por_cobrar() ? 'total', 'Facturación consulta por cobrar');
  perform tests.throws('select public.kpi_resultado()', 'NO_AUTORIZADO', 'Facturación NO consulta costo ni utilidad');
  perform tests.throws('select public.kpi_resultado(''2026-01-01'', ''2026-01-31'')', 'NO_AUTORIZADO', 'tampoco por periodo');
  perform tests.throws('select * from public._kpi_ventas(null, null)', 'permission denied', 'Facturación no ejecuta el interno _kpi_ventas');

  perform tests.act_as_anon();
  foreach f in array array['select public.kpi_ventas()', 'select public.kpi_por_cobrar()', 'select public.kpi_resultado()',
                           'select * from public._kpi_ventas(null, null)', 'select public.dia_negocio(now())'] loop
    perform tests.throws(f, 'permission denied', 'anónimo no ejecuta ' || split_part(split_part(f, 'public.', 2), '(', 1));
  end loop;

  -- Dirección sí, y ni ella ejecuta el interno suelto.
  perform tests.act_as(v_admin);
  perform tests.ok(public.kpi_ventas() ? 'ventas', 'Dirección consulta ventas y cobranza');
  perform tests.ok(public.kpi_por_cobrar() ? 'total', 'Dirección consulta por cobrar');
  perform tests.ok(public.kpi_resultado() ? 'costo_confiable', 'Dirección consulta el resultado');
  perform tests.throws('select * from public._kpi_ventas(null, null)', 'permission denied', 'ni Dirección ejecuta el interno suelto');
  perform tests.throws('select public.kpi_ventas(''2026-02-01'', ''2026-01-01'')', 'PERIODO_INVALIDO', 'un periodo al revés se rechaza');
  perform tests.throws('select public.kpi_resultado(''2026-02-01'', ''2026-01-01'')', 'PERIODO_INVALIDO', 'también en el resultado');

  -- Un perfil sin sesión válida (rol vacío) falla cerrado.
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform tests.throws('select public.kpi_resultado()', 'NO_AUTORIZADO', 'una sesión sin perfil no ve costo ni utilidad');

  -- El costo no se filtra por kpi_ventas: esa función no trae ninguna llave de costo.
  perform tests.act_as(v_admin);
  perform tests.ok(not exists (select 1 from jsonb_object_keys(public.kpi_ventas()) k where k ~ 'costo|utilidad|margen'),
    'kpi_ventas no expone costo, utilidad ni margen');
  perform tests.act_as_owner();
  perform tests.ok(
    (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=public%')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('kpi_ventas', 'kpi_por_cobrar', 'kpi_resultado', '_kpi_ventas')),
    'SECURITY DEFINER con search_path fijo');
  perform tests.ok(to_regclass('public.idx_orders_created_at') is not null and to_regclass('public.idx_payment_entries_value_date') is not null,
    'existen los dos índices que usan las consultas de indicadores');
end $t$;
rollback;
