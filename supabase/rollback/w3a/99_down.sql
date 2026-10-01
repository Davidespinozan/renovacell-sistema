-- ============================================================================
-- W3-A · ROLLBACK (F4 → F1). Devuelve la base al estado que dejó W2-C.
--
-- USO: solo con autorización explícita.
--
-- REGLA QUE NO SE NEGOCIA: un rollback NUNCA borra evidencia fiscal. Si existe
-- cualquier documento con UUID del SAT, o en un estado que pudo producir efecto
-- ante el PAC (`incierto`, `en_proceso`), este archivo ABORTA antes de tocar nada.
-- En ese escenario se corrige hacia adelante: bajar el esquema dejaría un CFDI
-- real sin su rastro local, que es precisamente el daño que W3 existe para evitar.
--
-- W3-A no timbra ni cancela, así que en condiciones normales no hay evidencia y
-- el rollback es limpio. Verificado en local: supabase/tests/db/rollback/w3a_rollback.sql
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================

-- ------------------------------------------------ guarda: evidencia fiscal real
do $$
declare v_uuid int; v_ambiguo int; v_docs int;
begin
  if to_regclass('public.fiscal_documents') is null then
    raise notice 'W3-A no está aplicado: nada que bajar.';
    return;
  end if;
  select count(*) into v_uuid    from public.fiscal_documents where uuid is not null;
  select count(*) into v_ambiguo from public.fiscal_documents where status in ('en_proceso','incierto');
  select count(*) into v_docs    from public.fiscal_documents;
  if v_uuid > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % documento(s) con UUID del SAT. No se borra evidencia fiscal: se corrige hacia adelante.', v_uuid;
  end if;
  if v_ambiguo > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % documento(s) en estado en_proceso/incierto. Su efecto ante el PAC es desconocido y no se descarta bajando el esquema.', v_ambiguo;
  end if;
  if v_docs > 0 then
    raise notice 'W3-A: se bajarán % intención(es) fiscal(es) sin efecto ante el PAC (pendiente/fallido/cancelado sin UUID).', v_docs;
  end if;
end $$;

-- ------------------------------------------------------------------ revierte F4
-- Restaura orders_guard() y set_order_fiscal_snapshot() tal como estaban.
\ir 00_w2c_snapshot.sql

revoke all on function public.set_order_fiscal_snapshot(uuid, jsonb) from public, anon;
grant execute on function public.set_order_fiscal_snapshot(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------ revierte F3
drop function if exists public.solicitar_cfdi(uuid, uuid, jsonb);
drop function if exists public.descartar_solicitud_cfdi(uuid, uuid, text);
drop function if exists public.estado_fiscal_pedido(uuid);
drop function if exists public.conciliar_cfdi();
drop function if exists public._w3_reclamar(uuid, uuid);
drop function if exists public._w3_transicion(uuid, text, text, text, text, jsonb, text, text, text, text, text, timestamptz, text, text, uuid, text, uuid);
drop function if exists public._w3_proyectar(uuid);
drop function if exists public._w3_receptor(uuid, jsonb);
drop function if exists public._w3_norm_legacy(jsonb, text);
drop function if exists public._w3_op_begin(uuid, text, jsonb);
drop function if exists public._w3_op_finish(uuid, text, jsonb, jsonb);

-- ------------------------------------------------------------------ revierte F2
drop index if exists public.uq_fiscal_doc_vivo;
drop index if exists public.uq_fiscal_doc_uuid;
drop index if exists public.uq_fiscal_doc_serie_folio;

-- ------------------------------------------------------------------ revierte F1
drop trigger if exists trg_fiscal_documents_guard on public.fiscal_documents;
drop trigger if exists trg_fiscal_documents_no_truncate on public.fiscal_documents;
drop trigger if exists trg_fiscal_events_append_only on public.fiscal_document_events;
drop trigger if exists trg_fiscal_events_no_truncate on public.fiscal_document_events;
drop trigger if exists trg_fiscal_operations_append_only on public.fiscal_operations;
drop trigger if exists trg_fiscal_operations_no_truncate on public.fiscal_operations;
-- La bitácora es append-only: para poder soltar las tablas hay que desactivar la
-- guarda con el mismo interruptor que usan las purgas controladas.
select set_config('renovacell.purge', 'on', true);
drop table if exists public.fiscal_document_events;
drop table if exists public.fiscal_documents;
drop table if exists public.fiscal_operations;
select set_config('renovacell.purge', 'off', true);
drop function if exists public.fiscal_documents_guard();
drop function if exists public._w3_fingerprint(uuid, jsonb);
drop function if exists public._w3_transicion_valida(text, text);
