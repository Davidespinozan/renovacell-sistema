-- W3-C · C4-D · El rollback quita candidatos por familia y coherencia, y ABORTA si
-- hay validación humana: sin la coherencia estructural, una decisión ya validada
-- quedaría sin red.
begin;

-- ── 1) LA GUARDA ────────────────────────────────────────────────────────────
savepoint antes;
do $t$
declare v_admin uuid := tests.user('admin'); v_p uuid;
begin
  v_p := tests.producto_cat('Vitaminas');
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
      'con validación humana presente, el rollback ABORTA en vez de dejarla sin coherencia');
  end;
end $t$;
rollback to savepoint antes;

-- ── 2) SIN VALIDACIONES, BAJA LIMPIO ────────────────────────────────────────
savepoint antes_bajada;
do $t$
declare v_admin uuid := tests.user('admin');
begin
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.product_fiscal where validado), 0,
    'punto de partida: ninguna validación humana');
  perform tests.ok(to_regclass('public.fiscal_family_defaults') is not null,
    'la tabla de candidatos por familia existe antes de bajar');
end $t$;

select tests.act_as_owner();
drop function if exists public.aplicar_defaults_familia(uuid, text);
drop function if exists public.definir_defaults_familia(uuid, text, jsonb);
drop trigger  if exists trg_ffd_guard on public.fiscal_family_defaults;
drop function if exists public.fiscal_family_defaults_guard();
drop table    if exists public.fiscal_family_defaults;
alter table public.fiscal_category_defaults drop constraint if exists ck_fcd_objeto_tratamiento;
alter table public.product_fiscal           drop constraint if exists ck_pf_objeto_tratamiento;
drop function if exists public.pedido_fiscalmente_listo(uuid);
drop function if exists public._pf_objeto_coherente(text, text);

do $t$
begin
  perform tests.ok(to_regclass('public.fiscal_family_defaults') is null,
    'la tabla de candidatos por familia desapareció');
  perform tests.ok(to_regproc('public.aplicar_defaults_familia') is null,
    'y sus comandos también');
  perform tests.ok(to_regproc('public._pf_objeto_coherente') is null,
    'la coherencia estructural se retiró');
  -- Lo de C1/C2 sigue de pie: este rollback NO toca la ola anterior.
  perform tests.ok(to_regclass('public.product_fiscal') is not null,
    'C1 sigue en pie: product_fiscal no se tocó');
  perform tests.ok(to_regclass('public.fiscal_category_defaults') is not null,
    'los candidatos por categoría de C1 siguen en pie');
  perform tests.ok(to_regclass('public.fiscal_price_evidence') is not null,
    'la evidencia histórica de C2 sigue en pie');
  perform tests.ok(to_regproc('public.validar_fiscal_producto') is not null,
    'y la validación humana sigue disponible');
end $t$;
rollback to savepoint antes_bajada;

rollback;
