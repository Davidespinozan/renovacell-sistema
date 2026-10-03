-- ============================================================================
-- W3-C · C4-D · ROLLBACK. Quita los candidatos por familia y la coherencia
-- objeto↔tratamiento, devolviendo la base al estado que dejó C2.
--
-- ABORTA si hay validación fiscal humana: bajar la coherencia estructural
-- permitiría que una decisión ya validada quedara en un estado contradictorio.
-- Igual que en C1, el trabajo del contador no se descarta: se corrige hacia
-- adelante.
--
-- ORDEN: este rollback va ANTES que el de C1/C2 (99_down.sql de w3c), porque
-- `ck_pf_objeto_tratamiento` cuelga de product_fiscal.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================

do $$
declare v_val int; v_fam int;
begin
  if to_regclass('public.fiscal_family_defaults') is null then
    raise notice 'W3-C C4-D no está aplicado: nada que bajar.';
    return;
  end if;
  select count(*) into v_val from public.product_fiscal where validado;
  if v_val > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % producto(s) con validación fiscal humana. Quitar la coherencia estructural dejaría esa decisión sin red.', v_val;
  end if;
  select count(*) into v_fam from public.fiscal_family_defaults;
  if v_fam > 0 then
    raise notice 'Se descartarán % fila(s) de candidatos por familia (son propuestas, no autoridad).', v_fam;
  end if;
end $$;

drop function if exists public.aplicar_defaults_familia(uuid, text);
drop function if exists public.definir_defaults_familia(uuid, text, jsonb);
drop trigger  if exists trg_ffd_guard on public.fiscal_family_defaults;
drop function if exists public.fiscal_family_defaults_guard();
drop table    if exists public.fiscal_family_defaults;

alter table if exists public.fiscal_category_defaults drop constraint if exists ck_fcd_objeto_tratamiento;
alter table if exists public.product_fiscal           drop constraint if exists ck_pf_objeto_tratamiento;
drop function if exists public._pf_objeto_coherente(text, text);
