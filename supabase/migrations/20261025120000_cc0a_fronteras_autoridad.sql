-- ============================================================================
-- CC-0A · FRONTERAS DE AUTORIDAD EN EL SERVIDOR (precio · dinero · lotes · perfil).
--
-- Lo que se cierra (medido en producción el 5 oct 2026, read-only):
--   1. product_volume_prices: `pvp_read ... using (true)` → cualquier sesión, verificada o
--      no, leía los precios con descuento por volumen.
--   2. product_prices: el doctor leía su lista sin exigir estar verificado.
--   3. price_lists: la estructura de listas era legible por cualquier sesión.
--   4. v_order_money: vista owner=postgres (BYPASSRLS) concedida a anon y authenticated →
--      el dinero de TODOS los pedidos era legible por cualquier cuenta, incluso anónima.
--   5. v_stock_disponible: misma vista owner-run → lotes internos (código, caducidad,
--      ubicación) legibles por cualquier cuenta.
--   6. profiles_guard solo protegía `meta.capabilities`: un doctor podía reescribir su
--      propia evidencia de verificación (`verification`, `identity`, `cedula`, `verifyResult`).
--
-- Invariantes que se preservan (no se toca su texto): precio_de(), crear_pedido,
-- vender_pos, products_safe, product_stock, is_verified(), auth_role(), has_cap(), el
-- libro W2 (payment_entries/refunds/credit_grants) y sus comandos, la custodia W2-C, la
-- aprobación HUMANA del doctor (admin_approve_doctor). SEP/verify-cedula siguen siendo
-- evidencia: nada aquí fija `verified`.
--
-- Forward-fix / rollback: supabase/rollback/cc0a/99_down.sql (una transacción).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Precondiciones: el estado que esta migración asume (si no, abortar; nunca "arreglar").
-- ---------------------------------------------------------------------------
do $pre$
begin
  if to_regclass('public.product_volume_prices') is null or to_regclass('public.product_prices') is null
     or to_regclass('public.v_order_money') is null or to_regclass('public.v_stock_disponible') is null then
    raise exception 'CC0A: faltan objetos base (product_volume_prices / product_prices / v_order_money / v_stock_disponible)';
  end if;
  if to_regprocedure('public.is_verified()') is null or to_regprocedure('public.auth_role()') is null then
    raise exception 'CC0A: faltan is_verified()/auth_role() (W6-A1)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_volume_prices' and policyname = 'pvp_read') then
    raise exception 'CC0A: no existe la política pvp_read que se reemplaza';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'profiles' and t.tgname = 'profiles_guard_trg') then
    raise exception 'CC0A: no existe profiles_guard_trg';
  end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) LA frontera canónica de precio. Es la MISMA condición que ya usan products_safe y
--    product_stock (`auth_role() <> 'doctor' or is_verified()`), escrita una sola vez:
--      · sin sesión / sin perfil → auth_role() = '' → false (anon y service_role por RLS
--        no la necesitan: service_role salta RLS);
--      · doctor → solo verificado y activo (is_verified);
--      · personal → sí (active lo exige auth_role(): un suspendido lanza CUENTA_SUSPENDIDA).
--    No recibe uid: deriva la identidad de auth.uid() a través de los helpers.
-- ---------------------------------------------------------------------------
create or replace function public.puede_ver_precio() returns boolean
  language sql stable set search_path = public as
$$
  select public.auth_role() <> '' and (public.auth_role() <> 'doctor' or public.is_verified());
$$;
comment on function public.puede_ver_precio() is
  'CC-0A · Frontera única de visibilidad de precio: personal activo, o doctor activo Y verificado. Misma condición que products_safe/product_stock.';
revoke all on function public.puede_ver_precio() from public, anon;
grant execute on function public.puede_ver_precio() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) product_volume_prices: leer descuentos exige poder ver precio.
-- ---------------------------------------------------------------------------
drop policy if exists pvp_read on public.product_volume_prices;
create policy pvp_read on public.product_volume_prices
  for select to authenticated using (public.puede_ver_precio());
revoke all on public.product_volume_prices from anon;

-- ---------------------------------------------------------------------------
-- 3) product_prices: el personal conserva su lectura; el doctor lee SOLO su lista y SOLO
--    si puede ver precio. (La lista de roles es la que ya existía: no se amplía.)
-- ---------------------------------------------------------------------------
drop policy if exists product_prices_read on public.product_prices;
create policy product_prices_read on public.product_prices
  for select to authenticated using (
    public.auth_role() = any (array['admin','billing','pos','warehouse','packing','comm'])
    or (public.puede_ver_precio()
        and list_id = (select p.price_list_id from public.profiles p where p.id = auth.uid()))
  );
revoke all on public.product_prices from anon;

-- ---------------------------------------------------------------------------
-- 4) price_lists: los nombres/estructura de listas también son pricing.
-- ---------------------------------------------------------------------------
drop policy if exists price_lists_read on public.price_lists;
create policy price_lists_read on public.price_lists
  for select to authenticated using (public.puede_ver_precio());
revoke all on public.price_lists from anon;

-- ---------------------------------------------------------------------------
-- 5) v_order_money: "ves el dinero de los pedidos que puedes ver".
--    NO se usa security_invoker: la aritmética del libro necesita leer payment_entries /
--    refunds / credit_grants completos (el doctor no tiene SELECT sobre el libro y su
--    saldo se volvería falso). La vista sigue corriendo como owner y añade UN filtro:
--    `pedido_visible(order_id)`, función SIN security definer, que evalúa la RLS de
--    `orders` con la identidad del que consulta. Dentro de los comandos W2/W5 (SECURITY
--    DEFINER, dueño postgres) el filtro es trivialmente verdadero: su aritmética y sus
--    resultados no cambian.
-- ---------------------------------------------------------------------------
create or replace function public.pedido_visible(p_order uuid) returns boolean
  language sql stable set search_path = public as
$$ select exists (select 1 from public.orders o where o.id = p_order) $$;
comment on function public.pedido_visible(uuid) is
  'CC-0A · ¿El que consulta puede ver este pedido según la RLS de orders? (security INVOKER a propósito).';
revoke all on function public.pedido_visible(uuid) from public, anon;
grant execute on function public.pedido_visible(uuid) to authenticated, service_role;

-- Definición IDÉNTICA a W2 (20261013120000, F-5/F-7) + el filtro final.
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
  -- F-7: liberado para surtir = cobro suficiente OR crédito autorizado vigente.
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
  -- Autorizado − pagado NETO (una reversa de un egreso vuelve a dejar el reembolso pendiente).
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
) cg on true
where public.pedido_visible(o.id);

comment on view public.v_order_money is
  'W2 · definición ÚNICA del dinero por pedido. cobrado_neto = Σin − Σout; saldo = total − cobrado_neto; '
  'liberado = cobro suficiente OR crédito autorizado vigente (derivado, sin columna cacheada). '
  'CC-0A: solo filas de pedidos visibles para quien consulta (RLS de orders).';
revoke all on public.v_order_money from anon, public;
grant select on public.v_order_money to authenticated;

-- ---------------------------------------------------------------------------
-- 6) v_stock_disponible: lotes internos. Pasa a security_invoker: la RLS de `lots`
--    (`lots_select_ops`: admin/warehouse/packing/pos/billing) decide; custody_held() es
--    SECURITY DEFINER, así que la resta de custodia sigue siendo completa para quien sí
--    puede ver lotes. Doctor y anon: 0 filas. Los comandos W2-C (definer) no cambian.
-- ---------------------------------------------------------------------------
alter view public.v_stock_disponible set (security_invoker = true);
revoke all on public.v_stock_disponible from anon, public;
grant select on public.v_stock_disponible to authenticated;
revoke all on public.lots from anon;

-- ---------------------------------------------------------------------------
-- 7) profiles_guard: la evidencia y la autoridad que viven en `meta` solo las escribe el
--    servidor (service_role: register-doctor, verify-cedula, invite-doctor, staff-admin),
--    un comando (app.trusted) o Dirección. Texto W6-A1 íntegro + el bloque META_PROTEGIDA.
--    Claves protegidas = las que deciden verificación, identidad, propiedad comercial y
--    acceso. `name`, `avatar_url`, `fiscal` (legacy), `shipping` siguen editables.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare
  v_protegidas text[] := array['capabilities','verification','identity','verifyResult','cedula',
                               'commercial','owner','seller_profile_id','fromProspect','invited',
                               'active','baja'];
  k text;
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
  -- CC-0A: evidencia de verificación y autoridad comercial: solo servidor/comando/Dirección.
  foreach k in array v_protegidas loop
    if coalesce(new.meta -> k, 'null'::jsonb) is distinct from coalesce(old.meta -> k, 'null'::jsonb) then
      raise exception 'META_PROTEGIDA: la clave "%" del perfil la decide el servidor o Dirección, no el usuario.', k
        using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Verificación final: abortar si el estado no es el diseñado.
-- ---------------------------------------------------------------------------
do $post$
declare v_q text; v_opts text[];
begin
  select qual into v_q from pg_policies where schemaname = 'public' and tablename = 'product_volume_prices' and policyname = 'pvp_read';
  if v_q not like '%puede_ver_precio()%' then raise exception 'CC0A: pvp_read no quedó con puede_ver_precio(): %', v_q; end if;
  select qual into v_q from pg_policies where schemaname = 'public' and tablename = 'price_lists' and policyname = 'price_lists_read';
  if v_q not like '%puede_ver_precio()%' then raise exception 'CC0A: price_lists_read no quedó con puede_ver_precio(): %', v_q; end if;
  select qual into v_q from pg_policies where schemaname = 'public' and tablename = 'product_prices' and policyname = 'product_prices_read';
  if v_q not like '%puede_ver_precio()%' then raise exception 'CC0A: product_prices_read sin frontera: %', v_q; end if;
  if pg_get_viewdef('public.v_order_money'::regclass) not like '%pedido_visible(o.id)%' then
    raise exception 'CC0A: v_order_money no quedó filtrada por pedido_visible';
  end if;
  select reloptions into v_opts from pg_class where oid = 'public.v_stock_disponible'::regclass;
  if v_opts is null or not ('security_invoker=true' = any (v_opts)) then
    raise exception 'CC0A: v_stock_disponible no quedó con security_invoker=true: %', v_opts;
  end if;
  if (select prosecdef from pg_proc where oid = 'public.pedido_visible(uuid)'::regprocedure) then
    raise exception 'CC0A: pedido_visible debe ser security INVOKER';
  end if;
  if pg_get_functiondef('public.profiles_guard()'::regprocedure) not like '%META_PROTEGIDA%' then
    raise exception 'CC0A: profiles_guard sin el bloque META_PROTEGIDA';
  end if;
  if has_table_privilege('anon', 'public.v_order_money', 'SELECT') or has_table_privilege('anon', 'public.v_stock_disponible', 'SELECT')
     or has_table_privilege('anon', 'public.product_volume_prices', 'SELECT') or has_table_privilege('anon', 'public.product_prices', 'SELECT')
     or has_table_privilege('anon', 'public.price_lists', 'SELECT') or has_table_privilege('anon', 'public.lots', 'SELECT') then
    raise exception 'CC0A: anon conserva SELECT sobre alguna superficie cerrada';
  end if;
end $post$;
