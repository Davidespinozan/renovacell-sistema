-- ============================================================================
-- CC-0A · ROLLBACK. Devuelve las políticas de precio, la vista de dinero, la opción de la
-- vista de lotes y profiles_guard a su texto ANTERIOR (W6-A1, md5 de producción
-- e701d0cb758330d71210eac028df7211); retira las funciones nuevas.
--
-- Lo ÚNICO que no se restaura es el SELECT de `anon` sobre vistas/tablas de precio,
-- dinero y lotes: era un privilegio por defecto del esquema, sin ningún consumidor, y
-- devolverlo reabriría la exposición anónima sin beneficio.
--
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================

-- 1) Políticas de precio: texto previo (20261002 / 20260709).
drop policy if exists pvp_read on public.product_volume_prices;
create policy pvp_read on public.product_volume_prices
  for select to authenticated using (true);

drop policy if exists product_prices_read on public.product_prices;
CREATE POLICY product_prices_read ON public.product_prices FOR SELECT TO authenticated USING (
  public.auth_role() = ANY (ARRAY['admin','billing','pos','warehouse','packing','comm'])
  OR list_id = (SELECT price_list_id FROM public.profiles WHERE id = auth.uid())
);

drop policy if exists price_lists_read on public.price_lists;
CREATE POLICY price_lists_read ON public.price_lists FOR SELECT TO authenticated USING (true);

-- 2) v_order_money: definición W2 sin filtro (20261013120000, F-5/F-7).
create or replace view public.v_order_money as
select
  o.id                                        as order_id,
  o.external_ref,
  o.status                                    as order_status,
  o.payment_status,
  coalesce(o.total, 0)                        as total,
  coalesce(e.cobrado, 0)                      as cobrado,
  coalesce(e.reembolsado, 0)                  as reembolsado,
  coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)                        as cobrado_neto,
  coalesce(o.total, 0) - (coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)) as saldo,
  case
    when coalesce(e.reembolsado, 0) > 0
         and coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0) <= 0            then 'refunded'
    when coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0) >= coalesce(o.total, 0)
         and coalesce(e.cobrado, 0) > 0                                          then 'paid'
    when coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0) > 0                 then 'parcial'
    else 'pending'
  end                                         as estado_pago,
  (coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)) > coalesce(o.total, 0)  as sobrepago,
  coalesce(rf.pendiente, 0)                   as reembolso_pendiente,
  (cg.id is not null)                         as credito_autorizado,
  cg.due_date,
  (cg.id is not null and cg.due_date < public.hoy_local())                     as vencido,
  ((coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)) >= coalesce(o.total, 0)
     and coalesce(o.total, 0) > 0)
    or cg.id is not null                      as liberado
from public.orders o
left join lateral (
  select sum(amount) filter (where direction = 'in')  as cobrado,
         sum(amount) filter (where direction = 'out') as reembolsado
    from public.payment_entries pe where pe.order_id = o.id
) e on true
left join lateral (
  select coalesce(sum(r.monto), 0) - coalesce((
           select sum(case when pe.direction = 'out' then pe.amount else -pe.amount end)
             from public.payment_entries pe
            where pe.order_id = o.id and pe.refund_id is not null
         ), 0) as pendiente
    from public.refunds r where r.order_id = o.id
) rf on true
left join lateral (
  select cgx.id, cgx.due_date from public.credit_grants cgx
   where cgx.order_id = o.id and cgx.revoked_at is null limit 1
) cg on true;
comment on view public.v_order_money is
  'W2 · definición ÚNICA del dinero por pedido. cobrado_neto = Σin − Σout; saldo = total − cobrado_neto; '
  'liberado = cobro suficiente OR crédito autorizado vigente (derivado, sin columna cacheada).';
grant select on public.v_order_money to authenticated;

-- 3) v_stock_disponible: vuelve a owner-run.
alter view public.v_stock_disponible set (security_invoker = false);
grant select on public.v_stock_disponible to authenticated;

-- 4) profiles_guard: texto W6-A1 (verbatim).
create or replace function public.profiles_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if coalesce(current_setting('app.trusted', true), '') = 'on'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  -- W6-A1: la autoridad de acceso y el rol solo cambian por comando (Dirección incluida).
  if new.active is distinct from old.active then
    raise exception 'ACCESO_SOLO_POR_COMANDO: el acceso del personal se suspende o reactiva con el comando, no editando el perfil.';
  end if;
  if new.role_id is distinct from old.role_id then
    raise exception 'ROL_SOLO_POR_COMANDO: el rol se cambia desde Equipo (servidor), no editando el perfil.';
  end if;
  if public.auth_role() = 'admin' then
    return new;
  end if;
  if new.verified is distinct from old.verified
     or new.price_list_id is distinct from old.price_list_id
     or (coalesce(new.meta -> 'capabilities', 'null'::jsonb) is distinct from coalesce(old.meta -> 'capabilities', 'null'::jsonb)) then
    raise exception 'No autorizado: no puedes modificar role_id, verified, price_list_id ni capacidades';
  end if;
  return new;
end;
$$;

-- 5) Funciones nuevas fuera.
drop function if exists public.pedido_visible(uuid);
drop function if exists public.puede_ver_precio();
