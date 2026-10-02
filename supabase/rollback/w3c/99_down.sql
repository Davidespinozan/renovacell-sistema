-- ============================================================================
-- W3-C · C1 · ROLLBACK. Devuelve la base al estado que dejó W3-B.
--
-- ABORTA si existe alguna validación fiscal humana: bajar el catálogo borraría
-- el trabajo del contador y el rastro de quién autorizó cada producto. Eso no
-- es un esquema recreable, es una decisión profesional registrada.
--
-- C1 no crea documentos fiscales ni consume folio, así que su rollback no toca
-- la frontera de numeración de W3-B.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================

do $$
declare v_val int; v_ev int;
begin
  if to_regclass('public.product_fiscal') is null then
    raise notice 'W3-C C1 no está aplicado: nada que bajar.';
    return;
  end if;
  select count(*) into v_val from public.product_fiscal where validado;
  select count(*) into v_ev  from public.product_fiscal_events where evento = 'validado';
  if v_val > 0 or v_ev > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % producto(s) con validación fiscal humana y % registro(s) de validación. No se borra el trabajo del contador: se corrige hacia adelante.', v_val, v_ev;
  end if;
end $$;

drop function if exists public.estado_validacion_fiscal();
drop function if exists public.aplicar_defaults_categoria(uuid, text);
drop function if exists public.definir_defaults_categoria(uuid, text, jsonb);
drop function if exists public.invalidar_fiscal_producto(uuid, uuid, text);
drop function if exists public.validar_fiscal_producto(uuid, uuid, text, text);
drop function if exists public.editar_fiscal_producto(uuid, uuid, jsonb, text);
drop function if exists public._pf_autorizar();
drop function if exists public._pf_snapshot(uuid);
drop function if exists public._pf_faltantes(uuid);
drop function if exists public._pf_campos_editables();
drop function if exists public._pf_campos_materiales();

-- Vocabulario de `kind` de vuelta al de W3-A/B.
alter table public.fiscal_operations drop constraint if exists ck_fiscal_op_kind;
alter table public.fiscal_operations add constraint fiscal_operations_kind_check check (kind in (
  'cfdi_solicitado','cfdi_actualizado','cfdi_descartado',
  'cfdi_reclamado','cfdi_timbrado','cfdi_fallido','cfdi_incierto',
  'cfdi_conciliado','cfdi_cancelado'));

drop trigger if exists trg_product_fiscal_guard on public.product_fiscal;
drop trigger if exists trg_fcd_guard on public.fiscal_category_defaults;
drop trigger if exists trg_pfe_append_only on public.product_fiscal_events;
drop trigger if exists trg_pfe_no_truncate on public.product_fiscal_events;
select set_config('renovacell.purge', 'on', true);
drop table if exists public.product_fiscal_events;
drop table if exists public.product_fiscal;
drop table if exists public.fiscal_category_defaults;
select set_config('renovacell.purge', 'off', true);
drop function if exists public.product_fiscal_guard();
drop function if exists public.fiscal_category_defaults_guard();
