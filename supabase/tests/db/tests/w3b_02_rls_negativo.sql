-- W3-B · AUTORIDAD. La numeración fiscal y la evidencia de conciliación no las escribe
-- ningún cliente, y la conclusión negativa es exclusiva de Dirección.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_doctor uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  v_pos uuid := tests.user('pos'); v_p uuid := tests.product(100);
  v_o uuid; v_d uuid; r record;
begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.reclamar_id(v_d, 'sandbox');

  -- ── La numeración no se edita, por ningún rol ──────────────────────────────
  for r in select * from (values ('admin', v_admin), ('billing', v_bill), ('doctor', v_doctor),
                                 ('warehouse', v_wh), ('pos', v_pos)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws_any($q$insert into public.fiscal_series (serie) values ('HACK')$q$,
      array['permission denied', 'FISCAL_NUMERACION_SOLO_POR_COMANDO', 'row-level security'],
      format('el rol %s no inventa una serie fiscal', r.rol));
    perform tests.throws_any($q$update public.fiscal_folio_domains set next_folio = 1$q$,
      array['permission denied', 'FISCAL_NUMERACION_SOLO_POR_COMANDO', 'row-level security'],
      format('el rol %s no reinicia el contador de folios', r.rol));
    perform tests.throws_any(format($q$insert into public.fiscal_reconciliations (fiscal_document_id, probe_kind, outcome)
        values (%L, 'lookup_serie_folio', 'vacio')$q$, v_d),
      array['permission denied', 'row-level security'],
      format('el rol %s no fabrica evidencia de conciliación', r.rol));
    perform tests.throws_any(format('delete from public.fiscal_reconciliations where fiscal_document_id = %L', v_d),
      array['permission denied', 'LEDGER_APPEND_ONLY', 'row-level security'],
      format('el rol %s no borra evidencia de conciliación', r.rol));
  end loop;

  -- ── Reclamar: solo Dirección o Facturación ────────────────────────────────
  for r in select * from (values ('doctor', v_doctor), ('warehouse', v_wh), ('pos', v_pos)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws(format('select public.reclamar_cfdi(%L, %L, ''sandbox'')', gen_random_uuid(), v_d),
      'NO_AUTORIZADO', format('el rol %s no inicia un timbrado', r.rol));
    perform tests.throws(format('select public.identidad_cfdi(%L)', v_d),
      'NO_AUTORIZADO', format('el rol %s no ve la identidad fiscal', r.rol));
  end loop;

  -- ── La conclusión negativa es SOLO de Dirección ───────────────────────────
  for r in select * from (values ('billing', v_bill), ('doctor', v_doctor), ('pos', v_pos)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws(format('select public.resolver_cfdi_inexistente(%L, %L, ''motivo'')', gen_random_uuid(), v_d),
      'NO_AUTORIZADO', format('el rol %s no declara que no existe comprobante', r.rol));
  end loop;

  -- ── Internos: fuera del alcance de todos ──────────────────────────────────
  perform tests.act_as(v_admin);
  for r in select * from (values
      ('_w3_asignar_folio', $q$select public._w3_asignar_folio('facturama','sandbox','AAA010101AAA')$q$),
      ('_w3_ventana_replay', $q$select public._w3_ventana_replay()$q$),
      ('_w3_margen_replay', $q$select public._w3_margen_replay()$q$),
      ('_w3_separacion_sondeos', $q$select public._w3_separacion_sondeos()$q$)
    ) as t(fn, sql) loop
    perform tests.throws(r.sql, 'permission denied',
      format('ni Dirección invoca el interno %s', r.fn));
  end loop;

  -- ── Lectura acotada ───────────────────────────────────────────────────────
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.fiscal_series where serie = 'REN'), 1, 'Dirección lee las series');
  perform tests.act_as(v_doctor);
  perform tests.eq((select count(*)::int from public.fiscal_series), 0, 'el doctor no ve la numeración fiscal');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*)::int from public.fiscal_reconciliations), 0, 'almacén no ve la conciliación fiscal');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.fiscal_reconciliations', 'permission denied',
    'anónimo no tiene ni permiso de lectura sobre la conciliación');
  perform tests.throws('select count(*) from public.fiscal_folio_domains', 'permission denied',
    'anónimo no tiene ni permiso de lectura sobre el contador de folios');
end $t$;
rollback;
