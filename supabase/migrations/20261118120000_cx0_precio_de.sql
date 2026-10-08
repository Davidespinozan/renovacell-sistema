-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CX-0A (migración 135) · BARRERA DE AUTORIZACIÓN EN precio_de
--   Antes: precio_de(product, list[, qty]) era SECURITY DEFINER con EXECUTE para authenticated y SIN barrera:
--     · un doctor NO verificado (o un perfil sin rol) obtenía precio base, de lista y por volumen llamando la RPC
--       directamente, aunque products_safe / product_prices / product_volume_prices ya se los negaban (CC-0A);
--     · un doctor verificado podía pedir el precio de CUALQUIER lista (p_list arbitrario), aunque
--       product_prices solo le deja leer la suya.
--   Ahora precio_de/3 aplica EXACTAMENTE el alcance que ya decide la RLS (no abre ni cierra nada nuevo):
--     · contexto de servidor de confianza → sin barrera:
--         - Edge Function con service_role (cc_ia_precio vía Edge `chat`; ya filtra por el perfil);
--         - sesión de BD sin JWT y sin rol de API (migraciones, cron, consola de Dirección).
--       Toda petición de PostgREST lleva claims con 'role' y corre bajo authenticated/anon; anon no tiene EXECUTE.
--     · admin, billing, pos, warehouse, packing, comm → cualquier lista (= product_prices_read);
--     · puede_ver_precio() (doctor verificado, chofer) → solo precio base (p_list null) o SU lista (= product_prices_read);
--     · cualquier otro (doctor no verificado, sin perfil, lista ajena) → PRECIO_NO_AUTORIZADO (insufficient_privilege);
--     · cuenta suspendida → auth_role() falla cerrado (CUENTA_SUSPENDIDA).
--   La identidad se evalúa siempre con la del LLAMADOR original (claims + GUC role no cambian dentro de
--   SECURITY DEFINER), así que crear_pedido / vender_pos / cc_checkout_confirmar no son un rodeo.
--   precio_de/2 no cambia: es el envoltorio que delega en /3 y hereda la barrera.
--   El cálculo (LEAST(base de lista ∥ General, mejor escala de volumen)) es idéntico al de 20261002120000.
--   Rollback: supabase/rollback/cx0/99_down.sql (restaura el texto anterior, md5 de producción).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.precio_de(uuid,uuid,integer)') is null or to_regprocedure('public.precio_de(uuid,uuid)') is null
     or to_regprocedure('public.puede_ver_precio()') is null or to_regprocedure('public.auth_role()') is null then
    raise exception 'CX-0A: requiere precio_de/2, precio_de/3, puede_ver_precio y auth_role';
  end if;
  if md5(pg_get_functiondef('public.precio_de(uuid,uuid,integer)'::regprocedure)) <> '9efe19506f40e19c3dc5baeca66b9014' then
    raise exception 'CX-0A: precio_de/3 no es el texto esperado (ya aplicada o cambió en producción)';
  end if;
end $pre$;

create or replace function public.precio_de(p_product uuid, p_list uuid, p_qty int) returns numeric
  language plpgsql stable security definer set search_path = public as
$$
declare
  v_claim_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_rol_sesion text := coalesce(current_setting('role', true), '');
  v_base numeric; v_vol numeric;
begin
  if not (v_claim_rol = 'service_role' or (v_claim_rol = '' and v_rol_sesion not in ('authenticated', 'anon'))) then
    if public.auth_role() = any (array['admin', 'billing', 'pos', 'warehouse', 'packing', 'comm']) then
      null;
    elsif public.puede_ver_precio()
          and (p_list is null or p_list = (select p.price_list_id from public.profiles p where p.id = auth.uid())) then
      null;
    else
      raise exception 'PRECIO_NO_AUTORIZADO: no tienes acceso a este precio' using errcode = 'insufficient_privilege';
    end if;
  end if;

  select coalesce(
           (select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = p_list),
           (select pr.price from public.products pr where pr.id = p_product))
    into v_base;
  select pv.price into v_vol from public.product_volume_prices pv
   where pv.product_id = p_product and pv.active and pv.min_quantity <= p_qty
   order by pv.min_quantity desc limit 1;
  return case when v_vol is null then v_base else least(v_base, v_vol) end;
end;
$$;
comment on function public.precio_de(uuid, uuid, integer) is 'CX-0A · Precio autorizado (lista ∥ General, LEAST con volumen) con barrera: mismo alcance que la RLS de product_prices.';

revoke all on function public.precio_de(uuid, uuid, int) from public, anon;
grant execute on function public.precio_de(uuid, uuid, int) to authenticated, service_role;
