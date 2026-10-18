-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- FLYERS (migración 180) · PROMO-9: las piezas de marketing que la empresa ya manda por WhatsApp, Facebook e historias
--   ("HOY ÚLTIMO DÍA · Botox $3,900", "¡Nuevo lote!", "Implantes $2,400") viven en el sistema y se le muestran al doctor en su
--   Inicio. Dueño (18 oct 2026): "para hacer más visual la app, a los doctores les aparecerían estas en su inicio … ahorita
--   se ve muy triste el portal del doctor".
--   · flyers              imagen (URL pública de Storage), título, vigencia, opcionalmente ligado a una promoción (entonces
--                         vive y muere con ella) o a un producto; por lista de precios; orden.
--   · flyers_vigentes()   lo que ve el doctor (solo vigentes y de su lista); staff ve todos los vigentes.
--   · flyers_lista()      administración (Dirección / Facturación), con estado.
--   · flyer_guardar / flyer_estado / flyer_eliminar.
--   · _promo_texto        + 'flyer_url': el correo y la tarjeta del chat de una promoción llevan su flyer si lo tiene.
--   Depende de la 179. Rollback: supabase/rollback/flyers/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.promocion_avisos_pendientes(uuid)') is null then raise exception 'FLYERS: falta la 179'; end if;
  if to_regclass('public.flyers') is not null then raise exception 'FLYERS: la tabla flyers ya existe'; end if;
  if md5(pg_get_functiondef('public._promo_texto(uuid)'::regprocedure)) <> '37095dd78da20caefeece12995cd4973' then raise exception 'FLYERS: _promo_texto no es la versión de la 177'; end if;
end $pre$;

create table public.flyers (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null check (length(btrim(titulo)) between 2 and 80),
  imagen_url   text not null check (imagen_url ~ '^https://' and length(imagen_url) <= 600),
  promocion_id uuid references public.promociones(id) on delete cascade,   -- ligado a una promo: vive y muere con ella
  product_id   uuid references public.products(id) on delete set null,
  desde        date not null,
  hasta        date,                                                       -- null = sin fecha de término (o la de la promo)
  activo       boolean not null default true,
  orden        int not null default 0,
  listas       uuid[],                                                     -- null = todas las listas
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ck_flyer_vigencia check (hasta is null or hasta >= desde)
);
create index idx_flyers_promo on public.flyers (promocion_id) where promocion_id is not null;
comment on table public.flyers is 'PROMO-9 · piezas de marketing (imagen vertical) que el doctor ve en su Inicio; opcionalmente ligadas a una promoción.';
alter table public.flyers enable row level security;
revoke all on public.flyers from public, anon, authenticated;

-- Estado de un flyer hoy: pausado / programado / vigente / terminado. Si está ligado a una promo, manda la promo.
create function public._flyer_estado(f public.flyers) returns text
  language plpgsql stable set search_path = public as
$$
declare p public.promociones%rowtype; hoy date := public._promo_hoy();
begin
  if not f.activo then return 'pausado'; end if;
  if f.promocion_id is not null then
    select * into p from public.promociones where id = f.promocion_id;
    if not found or not p.activa then return 'pausado'; end if;
    if hoy > p.hasta then return 'terminado'; end if;
    if hoy < p.desde then return 'programado'; end if;
  end if;
  if hoy < f.desde then return 'programado'; end if;
  if f.hasta is not null and hoy > f.hasta then return 'terminado'; end if;
  return 'vigente';
end;
$$;

create function public._flyer_json(f public.flyers) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('id', f.id, 'titulo', f.titulo, 'imagen_url', f.imagen_url, 'promocion_id', f.promocion_id,
           'promocion', (select p.nombre from public.promociones p where p.id = f.promocion_id),
           'product_id', f.product_id, 'producto', (select pr.name from public.products pr where pr.id = f.product_id),
           'desde', f.desde, 'hasta', coalesce(f.hasta, (select p.hasta from public.promociones p where p.id = f.promocion_id)),
           'activo', f.activo, 'orden', f.orden, 'listas', f.listas, 'estado', public._flyer_estado(f), 'updated_at', f.updated_at)
$$;

-- Lo que ve el doctor en su Inicio: flyers vigentes y de su lista de precios. Staff: todos los vigentes.
create function public.flyers_vigentes() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_lista uuid; v_rol text := public.auth_role();
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  if v_rol = 'doctor' then select price_list_id into v_lista from public.profiles where id = auth.uid(); end if;
  return coalesce((select jsonb_agg(public._flyer_json(f) order by f.orden, f.created_at desc)
                     from public.flyers f
                    where public._flyer_estado(f) = 'vigente'
                      and (v_rol <> 'doctor' or f.listas is null or (v_lista is not null and v_lista = any (f.listas)))), '[]'::jsonb);
end;
$$;
alter function public.flyers_vigentes() owner to postgres;
revoke all on function public.flyers_vigentes() from public, anon;
grant execute on function public.flyers_vigentes() to authenticated, service_role;

create function public.flyers_lista(p_todos boolean default true) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select case when public._promo_puede_administrar()
              then coalesce((select jsonb_agg(public._flyer_json(f) order by (public._flyer_estado(f) = 'vigente') desc, f.orden, f.created_at desc)
                               from public.flyers f where p_todos or public._flyer_estado(f) in ('vigente', 'programado')), '[]'::jsonb)
              else '[]'::jsonb end
$$;
alter function public.flyers_lista(boolean) owner to postgres;
revoke all on function public.flyers_lista(boolean) from public, anon;
grant execute on function public.flyers_lista(boolean) to authenticated;

create function public.flyer_guardar(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare f public.flyers%rowtype; v_id uuid; v_promo public.promociones%rowtype; v_listas uuid[]; v_desde date; v_hasta date;
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación administran flyers' using errcode = 'insufficient_privilege'; end if;
  v_id := nullif(p ->> 'id', '')::uuid;
  if length(btrim(coalesce(p ->> 'titulo', ''))) not between 2 and 80 then raise exception 'FLYER_INVALIDO: el título debe tener de 2 a 80 letras' using errcode = 'check_violation'; end if;
  if coalesce(p ->> 'imagen_url', '') !~ '^https://' or length(p ->> 'imagen_url') > 600 then raise exception 'FLYER_INVALIDO: falta la imagen del flyer' using errcode = 'check_violation'; end if;
  if nullif(p ->> 'promocion_id', '') is not null then
    select * into v_promo from public.promociones where id = (p ->> 'promocion_id')::uuid;
    if not found then raise exception 'FLYER_INVALIDO: esa promoción no existe' using errcode = 'check_violation'; end if;
  end if;
  if nullif(p ->> 'product_id', '') is not null and not exists (select 1 from public.products where id = (p ->> 'product_id')::uuid) then
    raise exception 'FLYER_INVALIDO: ese producto no existe' using errcode = 'check_violation';
  end if;
  v_desde := coalesce(nullif(p ->> 'desde', '')::date, v_promo.desde, public._promo_hoy());
  v_hasta := coalesce(nullif(p ->> 'hasta', '')::date, v_promo.hasta);
  if v_hasta is not null and v_hasta < v_desde then raise exception 'FLYER_INVALIDO: la fecha de término es anterior al inicio' using errcode = 'check_violation'; end if;
  if p ? 'listas' and jsonb_typeof(p -> 'listas') = 'array' and jsonb_array_length(p -> 'listas') > 0 then
    select array_agg(x::uuid) into v_listas from jsonb_array_elements_text(p -> 'listas') x;
    if exists (select 1 from unnest(v_listas) l where not exists (select 1 from public.price_lists pl where pl.id = l)) then raise exception 'FLYER_INVALIDO: lista de precios desconocida' using errcode = 'check_violation'; end if;
  end if;
  if v_id is null then
    insert into public.flyers (titulo, imagen_url, promocion_id, product_id, desde, hasta, activo, orden, listas, created_by)
      values (btrim(p ->> 'titulo'), p ->> 'imagen_url', v_promo.id, nullif(p ->> 'product_id', '')::uuid, v_desde, v_hasta, coalesce((p ->> 'activo')::boolean, true), coalesce((p ->> 'orden')::int, 0), v_listas, auth.uid())
      returning * into f;
  else
    update public.flyers set titulo = btrim(p ->> 'titulo'), imagen_url = p ->> 'imagen_url', promocion_id = v_promo.id, product_id = nullif(p ->> 'product_id', '')::uuid,
           desde = v_desde, hasta = v_hasta, activo = coalesce((p ->> 'activo')::boolean, activo), orden = coalesce((p ->> 'orden')::int, orden), listas = v_listas, updated_at = now()
     where id = v_id returning * into f;
    if not found then raise exception 'FLYER_INEXISTENTE' using errcode = 'check_violation'; end if;
  end if;
  perform public.log_audit('Flyer guardado', f.titulo, left(p::text, 1000), case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return public._flyer_json(f);
end;
$$;
alter function public.flyer_guardar(jsonb) owner to postgres;
revoke all on function public.flyer_guardar(jsonb) from public, anon;
grant execute on function public.flyer_guardar(jsonb) to authenticated;

create function public.flyer_estado(p_id uuid, p_activo boolean) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare f public.flyers%rowtype;
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación administran flyers' using errcode = 'insufficient_privilege'; end if;
  update public.flyers set activo = p_activo, updated_at = now() where id = p_id returning * into f;
  if not found then raise exception 'FLYER_INEXISTENTE' using errcode = 'check_violation'; end if;
  perform public.log_audit(case when p_activo then 'Flyer activado' else 'Flyer pausado' end, f.titulo, null, case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return public._flyer_json(f);
end;
$$;
alter function public.flyer_estado(uuid, boolean) owner to postgres;
revoke all on function public.flyer_estado(uuid, boolean) from public, anon;
grant execute on function public.flyer_estado(uuid, boolean) to authenticated;

create function public.flyer_eliminar(p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as
$$
declare v_titulo text;
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación administran flyers' using errcode = 'insufficient_privilege'; end if;
  delete from public.flyers where id = p_id returning titulo into v_titulo;
  if not found then raise exception 'FLYER_INEXISTENTE' using errcode = 'check_violation'; end if;
  perform public.log_audit('Flyer eliminado', v_titulo, null, case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return true;
end;
$$;
alter function public.flyer_eliminar(uuid) owner to postgres;
revoke all on function public.flyer_eliminar(uuid) from public, anon;
grant execute on function public.flyer_eliminar(uuid) to authenticated;

-- _promo_texto (177) + 'flyer_url': el flyer vigente de la promoción (si lo tiene) para el correo y la tarjeta del chat.
create or replace function public._promo_texto(p_id uuid) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare p public.promociones%rowtype; v_lineas text[]; v_vig text; r record; v_t text; v_prods jsonb; v_flyer text;
  meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  select * into p from public.promociones where id = p_id;
  if not found then return null; end if;
  v_vig := case when extract(month from p.desde) = extract(month from p.hasta)
                then format('del %s al %s de %s', extract(day from p.desde)::int, extract(day from p.hasta)::int, meses[extract(month from p.hasta)::int])
                else format('del %s de %s al %s de %s', extract(day from p.desde)::int, meses[extract(month from p.desde)::int], extract(day from p.hasta)::int, meses[extract(month from p.hasta)::int]) end;
  for r in select pr.name, array_agg(format('%s%s', case when l.min_qty > 1 then 'desde ' || l.min_qty || ' pzas ' else '' end, '$' || to_char(l.precio, 'FM999,999,990')) order by l.min_qty) as esc
             from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p_id group by pr.name order by pr.name loop
    v_lineas := array_append(v_lineas, r.name || ': ' || array_to_string(r.esc, ' · '));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.id, 'nombre', x.name, 'imagen_url', x.image_url, 'presentacion', x.unit, 'precio_normal', x.price, 'escalones', x.esc) order by x.name), '[]'::jsonb) into v_prods
    from (select pr.id, pr.name, pr.image_url, pr.unit, pr.price, jsonb_agg(jsonb_build_object('desde', l.min_qty, 'precio', l.precio) order by l.min_qty) as esc
            from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p_id group by pr.id, pr.name, pr.image_url, pr.unit, pr.price) x;
  -- PROMO-9 · el flyer de la promo (el primero vigente por orden), si lo tiene.
  select f.imagen_url into v_flyer from public.flyers f where f.promocion_id = p_id and public._flyer_estado(f) = 'vigente' order by f.orden, f.created_at desc limit 1;
  v_t := format('%s (%s)%s%s%sPrecios para profesionales verificados; se aplican solos en tu portal al pedir.', p.nombre, v_vig, E'\n', array_to_string(v_lineas, E'\n'), E'\n');
  return jsonb_build_object('nombre', p.nombre, 'descripcion', p.descripcion, 'vigencia', v_vig, 'desde', p.desde, 'hasta', p.hasta, 'lineas', to_jsonb(v_lineas), 'productos', v_prods, 'flyer_url', v_flyer, 'texto', v_t);
end;
$$;

do $post$ begin
  if has_function_privilege('anon', 'public.flyers_vigentes()', 'execute') or has_function_privilege('anon', 'public.flyer_guardar(jsonb)', 'execute')
     or has_table_privilege('authenticated', 'public.flyers', 'select') then raise exception 'FLYERS: permisos inesperados'; end if;
end $post$;
