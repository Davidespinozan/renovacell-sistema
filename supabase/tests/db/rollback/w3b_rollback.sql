-- W3-B · El rollback devuelve EXACTAMENTE el estado que dejó W3-A, y ABORTA antes de
-- borrar evidencia fiscal o de permitir reutilizar numeración ya entregada al PAC.
-- Corre en una transacción y se revierte.
-- Hashes capturados de un cluster con las migraciones hasta W3-A inclusive.
begin;

-- ── 1) LA GUARDA: con numeración consumida, el rollback se niega ─────────────────────
-- Es el escenario peligroso propio de W3-B: bajar el contador dejaría al sistema capaz
-- de volver a entregar un folio que ya viajó al proveedor, y la deduplicación de
-- Facturama es (Folio, Date). Reutilizarlo es la receta de un comprobante duplicado.
savepoint antes_de_la_guarda;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.reclamar_id(v_d, 'produccion');
  perform tests.ok((select folio is not null from public.fiscal_documents where id = v_d),
    'la guarda parte de numeración realmente consumida');

  -- El contador de folios no tiene lectura para `authenticated` (y debe ser así): el
  -- sondeo se hace como dueño, igual que tests.sin_efecto.
  perform tests.act_as_owner();
  begin
    if (select count(*) from public.fiscal_documents where folio is not null) > 0
       or (select coalesce(max(next_folio), 1) - 1 from public.fiscal_folio_domains) > 0 then
      raise exception 'ROLLBACK_ABORTADO: hay numeración fiscal consumida';
    end if;
    perform tests.ok(false, 'el rollback debía abortar con numeración consumida');
  exception when others then
    perform tests.ok(sqlerrm like 'ROLLBACK_ABORTADO%',
      'con numeración ya entregada al PAC, el rollback ABORTA en vez de permitir reutilizarla');
  end;
end $t$;
rollback to savepoint antes_de_la_guarda;

-- ── 2) Sin evidencia ni numeración, el rollback restaura el estado de W3-A ───────────
-- Las pruebas de concurrencia confirman sus transacciones y dejan numeración viva en la
-- base de pruebas; se limpia DENTRO de esta transacción (que se revierte) para ejercitar
-- el camino limpio. Que la guarda del punto 1 se niegue con ella presente es lo correcto.
select set_config('renovacell.purge', 'on', true);
delete from public.fiscal_reconciliations;
delete from public.fiscal_document_events;
delete from public.fiscal_documents;
delete from public.fiscal_operations;
delete from public.fiscal_folio_domains;
select set_config('renovacell.purge', 'off', true);

\ir ../../../rollback/w3b/00_w3a_snapshot.sql
\ir ../../../rollback/w3b/99_down.sql
do $t$
declare r record;
begin
  for r in select * from (values
    ('fiscal_documents_guard()',    '655ad14d1cda822a18fbe9c6c84a1416'),
    ('estado_fiscal_pedido(uuid)',  '681a529eb7c4f2c62febce43d132ebcb'),
    ('conciliar_cfdi()',            '6092889dbb4bb60c5de24b41a17810fe')
  ) as t(sig, h) loop
    perform tests.eq(md5(pg_get_functiondef(('public.' || r.sig)::regprocedure)), r.h,
      'rollback W3-B restaura la versión de W3-A: ' || r.sig);
  end loop;

  -- Nada de W3-B queda vivo.
  perform tests.eq((select count(*)::int from information_schema.tables where table_schema = 'public'
                     and table_name in ('fiscal_series','fiscal_folio_domains','fiscal_reconciliations')), 0,
    'rollback W3-B: las tablas de numeración y conciliación desaparecen');
  perform tests.eq((select count(*)::int from information_schema.columns where table_schema = 'public'
                     and table_name = 'fiscal_documents'
                     and column_name in ('provider_date_sent','issuer_rfc')), 0,
    'rollback W3-B: las columnas de identidad ante el proveedor desaparecen');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('reclamar_cfdi','identidad_cfdi',
                       'registrar_resultado_cfdi','registrar_sondeo_cfdi','adoptar_cfdi',
                       'resolver_cfdi_inexistente','evidencia_inexistencia_cfdi','_w3_asignar_folio',
                       '_w3_replay_vence','_w3_plazo_timbrado','_w3_margen_replay','_w3_ventana_replay',
                       '_w3_edad_minima_sondeo','_w3_separacion_sondeos','fiscal_numeracion_guard')), 0,
    'rollback W3-B: los comandos de numeración y conciliación desaparecen');
  perform tests.eq((select count(*)::int from pg_indexes where schemaname = 'public'
                     and indexname = 'uq_fiscal_folio_proveedor'), 0,
    'rollback W3-B: el índice de folio por proveedor desaparece');

  -- Y lo de W3-A, W2-C, W2 y W1 sigue en pie.
  perform tests.ok(to_regclass('public.fiscal_documents') is not null, 'rollback W3-B: la intención durable de W3-A sigue intacta');
  perform tests.ok(to_regprocedure('public.solicitar_cfdi(uuid,uuid,jsonb)') is not null, 'rollback W3-B: solicitar_cfdi sigue intacta');
  perform tests.ok(to_regclass('public.custody_lines') is not null, 'rollback W3-B: el libro de custodia de W2-C sigue intacto');
  perform tests.ok(to_regclass('public.payment_entries') is not null, 'rollback W3-B: el libro de dinero de W2 sigue intacto');
  perform tests.ok(to_regclass('public.inventory_movements') is not null, 'rollback W3-B: el kardex de W1 sigue intacto');
end $t$;
rollback;
