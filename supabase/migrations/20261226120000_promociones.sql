-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PROMOCIONES (migración 173) · PROMO-1: una promoción con nombre, vigencia y varios productos (precio o escalones por
--   cantidad) que se aplica SOLA mientras dura, en el portal, el punto de venta y el chat, sin tocar producto por producto.
--   Pedido del dueño (18 oct 2026, "para mí es lo más importante"): "Precios de promo Allergan: Botox 1 pieza $4,000 ·
--   5 a 9 $3,800 · 10 $3,600 · Skinvive $3,600 · HarmonyCa $6,100 · del 16 al 25 de octubre".
--   Decisiones (por defecto): aplica a todas las listas (o a las que se elijan); NUNCA se cobra más que el precio normal
--   del cliente (LEAST con lista y volumen); "5 a 9" y "10" son escalones "desde"; las administra Dirección (y Facturación,
--   como Precios). La autoridad sigue siendo precio_de/3: aquí solo se le suma la promoción vigente.
--   · promociones / promocion_lineas   la promoción y sus renglones (producto, desde N piezas, precio unitario).
--   · _promo_precio                    mejor precio de promoción vigente para producto/lista/cantidad (servidor).
--   · precio_de/3                      = LEAST(base, volumen, promoción vigente); barrera CX-0A intacta.
--   · promos_vigentes()                lo que el portal y la caja muestran (escalones vigentes con nombre y "hasta").
--   · promociones_lista / promocion_guardar / promocion_estado   administración (Dirección o Facturación) con bitácora.
--   Depende de la 135 (precio_de/3 con barrera). Aplicar en UNA transacción. Rollback: supabase/rollback/promociones/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.promociones') is not null then raise exception 'PROMOCIONES: ya aplicada'; end if;
  if md5(pg_get_functiondef('public.precio_de(uuid,uuid,integer)'::regprocedure)) <> '349176d8415cc46db01f1eaf887c9255' then raise exception 'PROMOCIONES: precio_de/3 no es la versión de la 135'; end if;
end $pre$;

create table public.promociones (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(btrim(nombre)) between 2 and 120),
  descripcion text check (descripcion is null or length(descripcion) <= 500),
  desde       date not null,
  hasta       date not null,
  activa      boolean not null default true,
  listas      uuid[],                            -- null = todas las listas de precio; si no, solo esas
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  constraint ck_promo_vigencia check (desde <= hasta)
);
create table public.promocion_lineas (
  id           uuid primary key default gen_random_uuid(),
  promocion_id uuid not null references public.promociones(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  min_qty      int not null default 1 check (min_qty >= 1),
  precio       numeric not null check (precio >= 0),
  unique (promocion_id, product_id, min_qty)
);
create index idx_promo_lineas_producto on public.promocion_lineas (product_id);
create index idx_promo_vigencia on public.promociones (desde, hasta) where activa;
comment on table public.promociones is 'PROMO-1 · promociones por vigencia (fechas en hora de Culiacán) con varios productos; el precio lo aplica precio_de/3.';
alter table public.promociones enable row level security;
alter table public.promocion_lineas enable row level security;
revoke all on public.promociones, public.promocion_lineas from public, anon, authenticated;

-- Hoy en la zona del negocio (la misma del horario; America/Mazatlan si no está configurada).
create function public._promo_hoy() returns date
  language sql stable set search_path = public as
$$ select (now() at time zone coalesce((select zona from public.cc_horario_config where id = 1), 'America/Mazatlan'))::date $$;

-- Mejor precio de promoción VIGENTE para producto + lista + cantidad: por cada promoción activa y vigente que aplique a
-- la lista, el escalón más alto con min_qty <= cantidad; de todas, el precio más bajo. Null si no hay.
create function public._promo_precio(p_product uuid, p_list uuid, p_qty int) returns numeric
  language sql stable set search_path = public as
$$
  select min(x.precio) from (
    select distinct on (l.promocion_id) l.precio
      from public.promocion_lineas l join public.promociones p on p.id = l.promocion_id
     where l.product_id = p_product and l.min_qty <= greatest(coalesce(p_qty, 1), 1)
       and p.activa and public._promo_hoy() between p.desde and p.hasta
       and (p.listas is null or (p_list is not null and p_list = any (p.listas)))
     order by l.promocion_id, l.min_qty desc) x
$$;

-- precio_de/3 · texto de la 135 + la promoción vigente. La barrera de autorización NO cambia.
create or replace function public.precio_de(p_product uuid, p_list uuid, p_qty int) returns numeric
  language plpgsql stable security definer set search_path = public as
$$
declare
  v_claim_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_rol_sesion text := coalesce(current_setting('role', true), '');
  v_base numeric; v_vol numeric; v_promo numeric;
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
  -- PROMO-1 · la promoción vigente entra como un candidato más: nunca se cobra más que el precio normal del cliente.
  v_promo := public._promo_precio(p_product, p_list, p_qty);
  return (select min(x) from unnest(array[v_base, v_vol, v_promo]) x);
end;
$$;
comment on function public.precio_de(uuid, uuid, integer) is 'CX-0A + PROMO-1 · Precio autorizado = LEAST(base/lista, volumen, promoción vigente) con barrera: mismo alcance que la RLS de product_prices.';

-- Lo que se MUESTRA (portal, caja, chat): escalones vigentes con el nombre de la promoción y hasta cuándo. Misma barrera
-- que ver precios. Se devuelven las listas a las que aplica (null = todas) para que la pantalla las filtre si conoce la lista.
create function public.promos_vigentes() returns jsonb
  language sql stable security definer set search_path = public as
$$
  select coalesce(jsonb_agg(jsonb_build_object('promocion_id', p.id, 'nombre', p.nombre, 'desde', p.desde, 'hasta', p.hasta, 'listas', p.listas,
                                               'product_id', l.product_id, 'min_qty', l.min_qty, 'precio', l.precio)
                            order by p.hasta, p.nombre, l.product_id, l.min_qty), '[]'::jsonb)
    from public.promociones p join public.promocion_lineas l on l.promocion_id = p.id
   where auth.uid() is not null and public.puede_ver_precio()
     and p.activa and public._promo_hoy() between p.desde and p.hasta
$$;

-- Administración (Dirección o Facturación, como Precios).
create function public._promo_puede_administrar() returns boolean
  language sql stable set search_path = public as
$$ select auth.uid() is not null and public.auth_role() in ('admin', 'billing') $$;

create function public._promo_json(p_id uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'desde', p.desde, 'hasta', p.hasta, 'activa', p.activa, 'listas', p.listas,
           'estado', case when not p.activa then 'inactiva' when public._promo_hoy() < p.desde then 'proxima' when public._promo_hoy() > p.hasta then 'vencida' else 'vigente' end,
           'lineas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'product_id', l.product_id, 'producto', pr.name, 'precio_normal', pr.price, 'min_qty', l.min_qty, 'precio', l.precio) order by pr.name, l.min_qty)
                                from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p.id), '[]'::jsonb),
           'updated_at', p.updated_at)
    from public.promociones p where p.id = p_id
$$;

create function public.promociones_lista(p_todas boolean default true) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select coalesce(jsonb_agg(public._promo_json(p.id) order by (public._promo_hoy() between p.desde and p.hasta and p.activa) desc, p.desde desc), '[]'::jsonb)
    from public.promociones p
   where public._promo_puede_administrar()
     and (coalesce(p_todas, true) or (p.activa and p.hasta >= public._promo_hoy()))
$$;

-- p: {id?, nombre, descripcion?, desde, hasta, activa?, listas?: uuid[]|null, lineas: [{product_id, min_qty, precio}]}
-- Reemplaza los renglones completos (la promoción es una sola cosa). Valida productos activos, escalones sin repetir,
-- precios > 0 y fechas coherentes. Queda en la bitácora.
create function public.promocion_guardar(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_desde date; v_hasta date; v_nombre text; v_listas uuid[]; ln jsonb; v_n int := 0; v_pid uuid; v_qty int; v_precio numeric;
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación administran promociones' using errcode = 'insufficient_privilege'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 20000 then raise exception 'PROMO_INVALIDA: datos incompletos' using errcode = 'check_violation'; end if;
  v_nombre := nullif(btrim(coalesce(p ->> 'nombre', '')), '');
  v_desde := (p ->> 'desde')::date; v_hasta := (p ->> 'hasta')::date;
  if v_nombre is null or v_desde is null or v_hasta is null then raise exception 'PROMO_INVALIDA: nombre, desde y hasta son obligatorios' using errcode = 'check_violation'; end if;
  if v_desde > v_hasta then raise exception 'PROMO_INVALIDA: la fecha "desde" es posterior a "hasta"' using errcode = 'check_violation'; end if;
  if p ? 'listas' and jsonb_typeof(p -> 'listas') = 'array' and jsonb_array_length(p -> 'listas') > 0 then
    select array_agg(x::uuid) into v_listas from jsonb_array_elements_text(p -> 'listas') x;
    if exists (select 1 from unnest(v_listas) u where not exists (select 1 from public.price_lists pl where pl.id = u)) then raise exception 'PROMO_INVALIDA: lista de precios desconocida' using errcode = 'check_violation'; end if;
  end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then raise exception 'PROMO_INVALIDA: la promoción necesita al menos un producto' using errcode = 'check_violation'; end if;
  if jsonb_array_length(p -> 'lineas') > 200 then raise exception 'PROMO_INVALIDA: demasiados renglones' using errcode = 'check_violation'; end if;

  v_id := nullif(p ->> 'id', '')::uuid;
  if v_id is null then
    insert into public.promociones (nombre, descripcion, desde, hasta, activa, listas, created_by, updated_by)
    values (v_nombre, nullif(btrim(coalesce(p ->> 'descripcion', '')), ''), v_desde, v_hasta, coalesce((p ->> 'activa')::boolean, true), v_listas, auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.promociones set nombre = v_nombre, descripcion = nullif(btrim(coalesce(p ->> 'descripcion', '')), ''), desde = v_desde, hasta = v_hasta,
           activa = coalesce((p ->> 'activa')::boolean, activa), listas = v_listas, updated_at = now(), updated_by = auth.uid()
     where id = v_id;
    if not found then raise exception 'PROMO_INEXISTENTE' using errcode = 'check_violation'; end if;
    delete from public.promocion_lineas where promocion_id = v_id;
  end if;
  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    v_pid := nullif(ln ->> 'product_id', '')::uuid; v_qty := coalesce((ln ->> 'min_qty')::int, 1); v_precio := (ln ->> 'precio')::numeric;
    if v_pid is null or not exists (select 1 from public.products pr where pr.id = v_pid and pr.active) then raise exception 'PROMO_INVALIDA: producto inexistente o inactivo' using errcode = 'check_violation'; end if;
    if v_qty < 1 then raise exception 'PROMO_INVALIDA: la cantidad mínima debe ser 1 o más' using errcode = 'check_violation'; end if;
    if v_precio is null or v_precio <= 0 then raise exception 'PROMO_INVALIDA: el precio debe ser mayor que 0' using errcode = 'check_violation'; end if;
    begin
      insert into public.promocion_lineas (promocion_id, product_id, min_qty, precio) values (v_id, v_pid, v_qty, v_precio);
    exception when unique_violation then
      raise exception 'PROMO_INVALIDA: el mismo producto tiene dos escalones con la misma cantidad' using errcode = 'check_violation';
    end;
    v_n := v_n + 1;
  end loop;
  perform public.log_audit('Promoción guardada', v_nombre, left(p::text, 1000), case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return public._promo_json(v_id);
end;
$$;

create function public.promocion_estado(p_id uuid, p_activa boolean) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_nombre text;
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación administran promociones' using errcode = 'insufficient_privilege'; end if;
  update public.promociones set activa = coalesce(p_activa, activa), updated_at = now(), updated_by = auth.uid() where id = p_id returning nombre into v_nombre;
  if not found then raise exception 'PROMO_INEXISTENTE' using errcode = 'check_violation'; end if;
  perform public.log_audit(case when p_activa then 'Promoción activada' else 'Promoción pausada' end, v_nombre, null, case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return public._promo_json(p_id);
end;
$$;

alter function public._promo_hoy() owner to postgres;
alter function public._promo_precio(uuid, uuid, int) owner to postgres;
alter function public.promos_vigentes() owner to postgres;
alter function public._promo_puede_administrar() owner to postgres;
alter function public._promo_json(uuid) owner to postgres;
alter function public.promociones_lista(boolean) owner to postgres;
alter function public.promocion_guardar(jsonb) owner to postgres;
alter function public.promocion_estado(uuid, boolean) owner to postgres;
revoke all on function public._promo_hoy(), public._promo_precio(uuid, uuid, int), public._promo_puede_administrar(), public._promo_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.promos_vigentes(), public.promociones_lista(boolean), public.promocion_guardar(jsonb), public.promocion_estado(uuid, boolean) from public, anon;
grant execute on function public.promos_vigentes(), public.promociones_lista(boolean), public.promocion_guardar(jsonb), public.promocion_estado(uuid, boolean) to authenticated;
grant execute on function public.promos_vigentes() to service_role;   -- la IA del chat (Edge) puede mencionar la promo vigente
revoke all on function public.precio_de(uuid, uuid, int) from public, anon;
grant execute on function public.precio_de(uuid, uuid, int) to authenticated, service_role;

do $post$ begin
  if has_table_privilege('authenticated', 'public.promociones', 'select') or has_function_privilege('anon', 'public.promos_vigentes()', 'execute')
     or has_function_privilege('authenticated', 'public._promo_precio(uuid,uuid,integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.precio_de(uuid,uuid,integer)', 'execute') or has_function_privilege('anon', 'public.precio_de(uuid,uuid,integer)', 'execute') then
    raise exception 'PROMOCIONES: permisos inesperados';
  end if;
  if md5(pg_get_functiondef('public.precio_de(uuid,uuid)'::regprocedure)) <> 'b256810a5e089355712bdeffcb423832' then raise exception 'PROMOCIONES: precio_de/2 cambió (no debía)'; end if;
end $post$;
