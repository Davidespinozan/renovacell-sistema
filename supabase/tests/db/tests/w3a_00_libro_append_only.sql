-- W3-A · LA EVIDENCIA FISCAL NO SE EDITA NI SE BORRA. Misma disciplina que el kardex de
-- W1, el libro de dinero de W2 y el libro de custodia de W2-C: la historia es append-only
-- y el estado solo lo mueven los comandos, incluso para el dueño de la base.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_ev uuid; v_op uuid := gen_random_uuid();
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o, tests.fiscal(), v_op);
  perform tests.ok(v_d is not null, 'la solicitud crea la intención fiscal durable');

  perform tests.act_as_owner();
  select id into v_ev from public.fiscal_document_events where fiscal_document_id = v_d limit 1;

  -- ── La bitácora es inmutable ────────────────────────────────────────────────
  perform tests.throws(format('update public.fiscal_document_events set reason = ''otro'' where id = %L', v_ev),
    'LEDGER_APPEND_ONLY', 'una transición registrada no se edita');
  perform tests.throws(format('delete from public.fiscal_document_events where id = %L', v_ev),
    'LEDGER_APPEND_ONLY', 'una transición registrada no se borra');
  perform tests.ok(exists (select 1 from pg_trigger t
                            where t.tgrelid = 'public.fiscal_document_events'::regclass
                              and t.tgname = 'trg_fiscal_events_no_truncate'),
    'la bitácora fiscal tiene guarda contra TRUNCATE');

  -- ── El registro de operaciones es inmutable ─────────────────────────────────
  perform tests.throws('update public.fiscal_operations set result = ''{}''::jsonb',
    'LEDGER_APPEND_ONLY', 'el registro de operaciones fiscales no se edita');
  perform tests.throws(format('delete from public.fiscal_operations where op_id = %L', v_op),
    'LEDGER_APPEND_ONLY', 'el registro de operaciones fiscales no se borra');

  -- ── El documento fiscal solo lo escriben los comandos ──────────────────────
  perform tests.throws(format('update public.fiscal_documents set total = 99 where id = %L', v_d),
    'FISCAL_SOLO_POR_COMANDO', 'la intención fiscal no se edita a mano, ni desde la base');
  perform tests.throws(format('delete from public.fiscal_documents where id = %L', v_d),
    'FISCAL_NO_SE_BORRA', 'un documento fiscal no se elimina: es evidencia');
  perform tests.ok(exists (select 1 from pg_trigger t
                            where t.tgrelid = 'public.fiscal_documents'::regclass
                              and t.tgname = 'trg_fiscal_documents_no_truncate'),
    'los documentos fiscales tienen guarda contra TRUNCATE');

  -- ── Ni el estado, ni la identidad ──────────────────────────────────────────
  perform tests.throws(format('update public.fiscal_documents set status = ''timbrado'' where id = %L', v_d),
    'FISCAL_SOLO_POR_COMANDO', 'el estado fiscal no se mueve con un UPDATE directo');

  -- ── TODA transición queda registrada ──────────────────────────────────────
  perform tests.eq((select count(*)::int from public.fiscal_document_events where fiscal_document_id = v_d), 1,
    'la solicitud dejó su fila en la bitácora');
  perform tests.reclamar(v_d);
  perform tests.eq((select count(*)::int from public.fiscal_document_events where fiscal_document_id = v_d), 2,
    'el reclamo dejó su propia fila: ninguna transición pasa sin bitácora');
  perform tests.eq((select to_status from public.fiscal_document_events
                     where fiscal_document_id = v_d order by created_at desc limit 1), 'en_proceso',
    'la bitácora refleja el estado al que se movió');
  perform tests.eq((select from_status from public.fiscal_document_events
                     where fiscal_document_id = v_d order by created_at desc limit 1), 'pendiente',
    'la bitácora conserva DE DÓNDE venía');
end $t$;
rollback;
