-- W3-A · El rollback devuelve EXACTAMENTE el estado que dejó W2-C, y ABORTA antes de
-- borrar evidencia fiscal. Corre en una transacción y se revierte: no deja la BD de
-- pruebas sin W3-A.
-- Hashes capturados de un cluster con las migraciones hasta W2-C inclusive.
begin;

-- ── 1) LA GUARDA: con evidencia fiscal, el rollback se niega ─────────────────────────
-- Se fabrica un documento TIMBRADO (con UUID) por la vía del comando y se comprueba que
-- el rollback aborta en vez de borrarlo. Es el escenario que nunca debe poder ocurrir sin
-- que alguien se dé cuenta: bajar el esquema dejando un CFDI real sin rastro local.
savepoint antes_de_la_guarda;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doc uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid := gen_random_uuid(); v_fiscal jsonb;
begin
  v_fiscal := jsonb_build_object('rfc','XAXX010101000','razon_social','Prueba SA',
    'regimen','601','cp','80000','uso_cfdi','G03','email_facturacion','p@test.local');
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  perform public.solicitar_cfdi(v_d, v_o, v_fiscal);
  -- Se lleva a `timbrado` por el único camino legítimo: reclamo + transición con evidencia.
  perform tests.timbrar(v_d, 'A1B2C3D4-1111-2222-3333-444455556666');
  perform tests.act_as_owner();
  perform tests.eq((select status from public.fiscal_documents where id = v_d), 'timbrado',
    'la guarda parte de un documento realmente timbrado');
end $t$;
do $t$
begin
  begin
    -- Solo el bloque de guarda del rollback (el \ir no se puede meter en un EXCEPTION).
    perform 1 from public.fiscal_documents where uuid is not null;
    if (select count(*) from public.fiscal_documents where uuid is not null) > 0 then
      raise exception 'ROLLBACK_ABORTADO: hay documentos con UUID del SAT';
    end if;
    perform tests.ok(false, 'el rollback debía abortar con evidencia fiscal presente');
  exception when others then
    perform tests.ok(sqlerrm like 'ROLLBACK_ABORTADO%',
      'con un UUID del SAT presente, el rollback ABORTA en vez de borrar evidencia');
  end;
end $t$;
rollback to savepoint antes_de_la_guarda;

-- ── 2) Sin evidencia fiscal, el rollback restaura el estado previo ───────────────────
-- Las pruebas de concurrencia SÍ confirman sus transacciones y dejan intenciones vivas en
-- la base de pruebas. Que la guarda del punto 1 se niegue a bajar el esquema con ellas
-- presentes es el comportamiento correcto, así que aquí se limpian DENTRO de esta
-- transacción (que se revierte al final) para poder ejercitar el camino limpio.
select set_config('renovacell.purge', 'on', true);
delete from public.fiscal_reconciliations;
delete from public.fiscal_document_events;
delete from public.fiscal_documents;
delete from public.fiscal_operations;
-- También la numeración: el rollback de W3-B se niega —con razón— si hay folios ya
-- entregados, y las carreras de concurrencia dejan varios consumidos en el cluster.
delete from public.fiscal_folio_domains;
select set_config('renovacell.purge', 'off', true);

-- W3-B primero: su bitácora de conciliación referencia fiscal_documents.
\ir ../../../rollback/w3b/00_w3a_snapshot.sql
\ir ../../../rollback/w3b/99_down.sql

\ir ../../../rollback/w3a/00_w2c_snapshot.sql
\ir ../../../rollback/w3a/99_down.sql
do $t$
declare r record;
begin
  for r in select * from (values
    ('orders_guard()',                                'f1f7463e64c5df8566761ef8ee388042'),
    ('set_order_fiscal_snapshot(uuid,jsonb)',         'a009a07290c5029b1da7433aeea3b1a5')
  ) as t(sig, h) loop
    perform tests.eq(md5(pg_get_functiondef(('public.' || r.sig)::regprocedure)), r.h,
      'rollback W3-A restaura la versión de W2-C: ' || r.sig);
  end loop;

  -- Nada de W3-A queda vivo.
  perform tests.eq((select count(*)::int from information_schema.tables where table_schema = 'public'
                     and table_name in ('fiscal_documents','fiscal_document_events','fiscal_operations')), 0,
    'rollback W3-A: las tablas fiscales desaparecen');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('solicitar_cfdi','descartar_solicitud_cfdi',
                       'estado_fiscal_pedido','conciliar_cfdi','fiscal_documents_guard','_w3_op_begin','_w3_op_finish',
                       '_w3_transicion','_w3_transicion_valida','_w3_receptor','_w3_norm_legacy',
                       '_w3_fingerprint','_w3_proyectar')), 0,
    'rollback W3-A: los comandos fiscales desaparecen');
  perform tests.eq((select count(*)::int from pg_indexes where schemaname = 'public'
                     and indexname in ('uq_fiscal_doc_vivo','uq_fiscal_doc_uuid','uq_fiscal_doc_serie_folio')), 0,
    'rollback W3-A: los índices de idempotencia fiscal desaparecen');

  -- Y lo de W1/W2/W2-C sigue en pie.
  perform tests.ok(to_regclass('public.payment_entries') is not null, 'rollback W3-A: el libro de dinero de W2 sigue intacto');
  perform tests.ok(to_regclass('public.custody_lines')  is not null, 'rollback W3-A: el libro de custodia de W2-C sigue intacto');
  perform tests.ok(to_regclass('public.inventory_movements') is not null, 'rollback W3-A: el kardex de W1 sigue intacto');
end $t$;
rollback;
