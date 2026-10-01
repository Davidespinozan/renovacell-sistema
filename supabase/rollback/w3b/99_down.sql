-- ============================================================================
-- W3-B · ROLLBACK (B5 → B1). Devuelve la base al estado que dejó W3-A.
--
-- MISMA REGLA QUE W3-A, y aquí pesa más: un rollback NUNCA borra evidencia
-- fiscal. Si existe cualquier documento con UUID del SAT, o en un estado que
-- pudo producir efecto ante el PAC, este archivo ABORTA antes de tocar nada.
--
-- Además aborta si existe numeración CONSUMIDA. Bajar el contador de folios
-- dejaría al sistema capaz de volver a entregar un folio que ya viajó al PAC, y
-- la deduplicación de Facturama es (Folio, Date): reutilizarlo es exactamente
-- cómo se fabrica un comprobante duplicado.
--
-- Verificado en local: supabase/tests/db/rollback/w3b_rollback.sql
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================

do $$
declare v_uuid int; v_ambiguo int; v_folios int; v_consumidos bigint;
begin
  if to_regclass('public.fiscal_folio_domains') is null then
    raise notice 'W3-B no está aplicado: nada que bajar.';
    return;
  end if;
  select count(*) into v_uuid    from public.fiscal_documents where uuid is not null;
  select count(*) into v_ambiguo from public.fiscal_documents where status in ('en_proceso','incierto');
  select count(*) into v_folios  from public.fiscal_documents where folio is not null;
  select coalesce(max(next_folio), 1) - 1 into v_consumidos from public.fiscal_folio_domains;

  if v_uuid > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % documento(s) con UUID del SAT. No se borra evidencia fiscal.', v_uuid;
  end if;
  if v_ambiguo > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % documento(s) en estado en_proceso/incierto. Su efecto ante el PAC es desconocido.', v_ambiguo;
  end if;
  if v_folios > 0 or v_consumidos > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay numeración fiscal consumida (% documentos con folio, % folios entregados). Bajar el contador permitiría reutilizar un folio que ya viajó al PAC.', v_folios, v_consumidos;
  end if;
end $$;

-- ------------------------------------------------------------------ revierte B5
\ir 00_w3a_snapshot.sql

-- ------------------------------------------------------------------ revierte B4
drop function if exists public.resolver_cfdi_inexistente(uuid, uuid, text);
drop function if exists public.evidencia_inexistencia_cfdi(uuid);
drop function if exists public.adoptar_cfdi(uuid, uuid, text, text, timestamptz, text, text);
drop function if exists public.registrar_resultado_cfdi(uuid, uuid, uuid, text, text, text, timestamptz, text, text);
drop function if exists public.registrar_sondeo_cfdi(uuid, uuid, text, text, integer, text, text, text);

-- ------------------------------------------------------------------ revierte B2
drop function if exists public.identidad_cfdi(uuid);
drop function if exists public.reclamar_cfdi(uuid, uuid, text, uuid);
drop function if exists public._w3_replay_vence(text);
drop function if exists public._w3_asignar_folio(text, text, text);

-- ------------------------------------------------------------------ revierte B1
drop index if exists public.uq_fiscal_folio_proveedor;
alter table public.fiscal_documents
  drop constraint if exists ck_fiscal_identidad_proveedor,
  drop constraint if exists ck_fiscal_date_formato;
alter table public.fiscal_documents
  drop column if exists provider_date_sent,
  drop column if exists issuer_rfc;

drop trigger if exists trg_fiscal_recon_append_only on public.fiscal_reconciliations;
drop trigger if exists trg_fiscal_recon_no_truncate on public.fiscal_reconciliations;
drop trigger if exists trg_fiscal_series_guard on public.fiscal_series;
drop trigger if exists trg_fiscal_folio_domains_guard on public.fiscal_folio_domains;
-- La bitácora de conciliación es append-only: se usa el mismo interruptor que las
-- purgas controladas para poder soltar la tabla.
select set_config('renovacell.purge', 'on', true);
drop table if exists public.fiscal_reconciliations;
drop table if exists public.fiscal_series;
drop table if exists public.fiscal_folio_domains;
select set_config('renovacell.purge', 'off', true);
drop function if exists public.fiscal_numeracion_guard();

drop function if exists public._w3_separacion_sondeos();
drop function if exists public._w3_edad_minima_sondeo();
drop function if exists public._w3_ventana_replay();
drop function if exists public._w3_margen_replay();
drop function if exists public._w3_plazo_timbrado();
