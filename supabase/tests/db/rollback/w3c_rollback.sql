-- W3-C · C1 · El rollback devuelve el estado de W3-B y ABORTA si hay validación humana.
begin;

-- ── 1) LA GUARDA: con trabajo del contador registrado, se niega ──────────────────────
savepoint antes;
do $t$
declare v_admin uuid := tests.user('admin'); v_p uuid;
begin
  v_p := tests.producto_cat('Anestésicos');
  perform tests.act_as(v_admin);
  perform tests.pf_validado(v_p);
  perform tests.ok((select validado from public.product_fiscal where product_id = v_p),
    'la guarda parte de una validación humana real');
  begin
    if (select count(*) from public.product_fiscal where validado) > 0 then
      raise exception 'ROLLBACK_ABORTADO: hay validación fiscal humana';
    end if;
    perform tests.ok(false, 'el rollback debía abortar');
  exception when others then
    perform tests.ok(sqlerrm like 'ROLLBACK_ABORTADO%',
      'con validación fiscal humana presente, el rollback ABORTA en vez de borrar el trabajo del contador');
  end;
end $t$;
rollback to savepoint antes;

-- ── 1b) La evidencia histórica importada también detiene el rollback ────────────────
savepoint antes_evidencia;
do $t$
declare v_admin uuid := tests.user('admin'); v_p uuid;
begin
  v_p := tests.producto_cat('Metabólicos');
  perform tests.act_as(v_admin);
  perform public.importar_evidencia_precios(gen_random_uuid(),
    jsonb_build_array(tests.ev('excel:rb', 'HISTORICAL_EQUALS_FINAL', v_p, 'DIRECT_MATCH', 1350, 1350)));
  begin
    if (select count(*) from public.fiscal_price_evidence) > 0 then
      raise exception 'ROLLBACK_ABORTADO: hay evidencia histórica importada';
    end if;
    perform tests.ok(false, 'el rollback debía abortar');
  exception when others then
    perform tests.ok(sqlerrm like 'ROLLBACK_ABORTADO%',
      'con evidencia histórica importada, el rollback ABORTA: su origen es externo y no se reconstruye');
  end;
end $t$;
rollback to savepoint antes_evidencia;

-- ── 2) Sin validaciones, el rollback limpia ─────────────────────────────────────────
select set_config('renovacell.purge', 'on', true);
delete from public.fiscal_price_evidence;
delete from public.product_fiscal_events;
delete from public.product_fiscal;
delete from public.fiscal_category_defaults;
select set_config('renovacell.purge', 'off', true);

\ir ../../../rollback/w3c/99_down.sql
do $t$
begin
  perform tests.eq((select count(*)::int from information_schema.tables where table_schema='public'
                     and table_name in ('product_fiscal','fiscal_category_defaults','product_fiscal_events',
                                        'fiscal_price_evidence')), 0,
    'rollback W3-C: las tablas del catálogo fiscal y de la evidencia desaparecen');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname in ('editar_fiscal_producto','validar_fiscal_producto',
                       'invalidar_fiscal_producto','definir_defaults_categoria','aplicar_defaults_categoria',
                       'estado_validacion_fiscal','product_fiscal_guard','fiscal_category_defaults_guard',
                       '_pf_faltantes','_pf_snapshot','_pf_autorizar','_pf_campos_materiales','_pf_campos_editables',
                       'importar_evidencia_precios','excepciones_evidencia_fiscal','fiscal_price_evidence_guard')), 0,
    'rollback W3-C: los comandos del catálogo fiscal desaparecen');
  -- Y W3-A/W3-B siguen intactos, con su vocabulario de operaciones restaurado.
  perform tests.ok(to_regclass('public.fiscal_documents') is not null, 'rollback W3-C: la intención durable sigue intacta');
  perform tests.ok(to_regclass('public.fiscal_folio_domains') is not null, 'rollback W3-C: la numeración de W3-B sigue intacta');
  perform tests.ok(to_regprocedure('public.reclamar_cfdi(uuid,uuid,text,uuid)') is not null, 'rollback W3-C: reclamar_cfdi sigue intacta');
  perform tests.ok(to_regclass('public.custody_lines') is not null, 'rollback W3-C: el libro de custodia sigue intacto');
  perform tests.ok(to_regclass('public.payment_entries') is not null, 'rollback W3-C: el libro de dinero sigue intacto');
  perform tests.throws($q$insert into public.fiscal_operations (op_id, kind, request) values (gen_random_uuid(), 'pf_editado', '{}'::jsonb)$q$,
    'fiscal_operations_kind_check', 'rollback W3-C: el vocabulario de operaciones volvió al de W3-A/B');
end $t$;
rollback;
