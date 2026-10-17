-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- EMPAQUES (migración 172) · EMP-1: catálogo de hieleras y cajas con sus medidas, para que Empaque elija en vez de teclear
--   Pedido del dueño (17 oct 2026): "estos son los empaques utilizados, debe haber un selector". Decisión: el selector va en
--   Empaque (quien tiene el pedido en la mano y cotiza la guía), no en el vendedor; el catálogo lo administra Dirección o
--   Almacén. Las medidas vienen de la lista del dueño (largo × ancho × alto en cm); el peso vacío se captura cuando lo tengan.
--   · empaques            catálogo (nombre, tipo hielera|caja, medidas, peso vacío, frecuente, activo, orden).
--   · empaques_lista()    (personal) la lista activa, la más usada primero.
--   · empaque_guardar()   (Dirección o Almacén) alta/edición/activar-desactivar con bitácora.
--   NO toca pedidos, guías ni la paquetería. Aplicar en UNA transacción. Rollback: supabase/rollback/empaques/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.empaques') is not null then raise exception 'EMPAQUES: ya aplicada'; end if;
  if to_regclass('public.entrega_config') is null then raise exception 'EMPAQUES: falta la 171'; end if;
end $pre$;

create table public.empaques (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(btrim(nombre)) between 2 and 120),
  tipo        text not null default 'caja' check (tipo in ('hielera', 'caja')),
  largo_cm    numeric not null check (largo_cm > 0 and largo_cm <= 300),
  ancho_cm    numeric not null check (ancho_cm > 0 and ancho_cm <= 300),
  alto_cm     numeric not null check (alto_cm > 0 and alto_cm <= 300),
  peso_kg     numeric check (peso_kg is null or (peso_kg >= 0 and peso_kg <= 100)),   -- peso del empaque vacío (si se conoce)
  nota        text check (nota is null or length(nota) <= 200),
  frecuente   boolean not null default false,   -- "la que se utiliza más": va primero y se preselecciona
  activo      boolean not null default true,
  orden       smallint not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);
create unique index uq_empaques_nombre on public.empaques (lower(btrim(nombre)));
comment on table public.empaques is 'EMP-1 · catálogo de empaques (hieleras y cajas) con medidas para cotizar y generar guías en Empaque.';
alter table public.empaques enable row level security;
revoke all on public.empaques from public, anon, authenticated;

insert into public.empaques (nombre, tipo, largo_cm, ancho_cm, alto_cm, nota, frecuente, orden) values
  ('Hielera miniatura',                              'hielera', 13, 18, 14, null, false, 10),
  ('Hielera chica #4',                               'hielera', 20, 23, 22, 'La que se utiliza más', true, 1),
  ('Hielera chica #4 en caja grande (Estafeta)',     'hielera', 22, 22, 25, 'Para Estafeta', false, 20),
  ('Hielera chica #4 en caja grande, con riff arriba', 'hielera', 22, 25, 32, null, false, 21),
  ('Hielera grande #6',                              'hielera', 37, 21, 26, 'Es la más larga', false, 30),
  ('Hielera grande #7',                              'hielera', 30, 24, 22, null, false, 31),
  ('Hielera más grande #3',                          'hielera', 33, 43, 32, 'Donde van 50 piezas', false, 32),
  ('Caja chica',                                     'caja',    23, 17, 15, null, false, 40),
  ('Caja chica recortada',                           'caja',    23, 17, 12, null, false, 41),
  ('Caja grande',                                    'caja',    22, 22, 25, null, false, 42),
  ('Caja donde vienen las cápsulas',                 'caja',    27, 22, 14, null, false, 43),
  ('Caja Renovacell con 30 cápsulas',                'caja',    22, 25, 35, null, false, 44),
  ('Caja de café',                                   'caja',    25, 25, 13, null, false, 45);

-- Lista para el personal (Empaque, Almacén, Ventas y Dirección): activos, la frecuente primero, luego por orden y nombre.
create function public.empaques_lista(p_todos boolean default false) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'tipo', e.tipo, 'largo_cm', e.largo_cm, 'ancho_cm', e.ancho_cm, 'alto_cm', e.alto_cm,
                                               'peso_kg', e.peso_kg, 'nota', e.nota, 'frecuente', e.frecuente, 'activo', e.activo, 'orden', e.orden)
                            order by e.activo desc, e.frecuente desc, e.orden, lower(e.nombre)), '[]'::jsonb)
    from public.empaques e
   where auth.uid() is not null and public.auth_role() in ('admin', 'warehouse', 'packing', 'pos', 'billing', 'comm')
     and (e.activo or coalesce(p_todos, false))
$$;

-- Alta/edición (Dirección o Almacén). p: {id?, nombre, tipo, largo_cm, ancho_cm, alto_cm, peso_kg?, nota?, frecuente?, activo?, orden?}
create function public.empaque_guardar(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; r public.empaques%rowtype;
begin
  if auth.uid() is null or public.auth_role() not in ('admin', 'warehouse') then
    raise exception 'NO_AUTORIZADO: solo Dirección o Almacén administran los empaques' using errcode = 'insufficient_privilege';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 2000 then raise exception 'EMPAQUE_INVALIDO' using errcode = 'check_violation'; end if;
  v_id := nullif(p ->> 'id', '')::uuid;
  if v_id is null then
    insert into public.empaques (nombre, tipo, largo_cm, ancho_cm, alto_cm, peso_kg, nota, frecuente, activo, orden, updated_by)
    values (btrim(p ->> 'nombre'), coalesce(p ->> 'tipo', 'caja'), (p ->> 'largo_cm')::numeric, (p ->> 'ancho_cm')::numeric, (p ->> 'alto_cm')::numeric,
            nullif(p ->> 'peso_kg', '')::numeric, nullif(btrim(coalesce(p ->> 'nota', '')), ''), coalesce((p ->> 'frecuente')::boolean, false),
            coalesce((p ->> 'activo')::boolean, true), coalesce((p ->> 'orden')::smallint, 100), auth.uid())
    returning * into r;
  else
    select * into r from public.empaques where id = v_id for update;
    if not found then raise exception 'EMPAQUE_INEXISTENTE' using errcode = 'check_violation'; end if;
    update public.empaques set
      nombre    = coalesce(nullif(btrim(p ->> 'nombre'), ''), r.nombre),
      tipo      = coalesce(p ->> 'tipo', r.tipo),
      largo_cm  = coalesce((p ->> 'largo_cm')::numeric, r.largo_cm),
      ancho_cm  = coalesce((p ->> 'ancho_cm')::numeric, r.ancho_cm),
      alto_cm   = coalesce((p ->> 'alto_cm')::numeric, r.alto_cm),
      peso_kg   = case when p ? 'peso_kg' then nullif(p ->> 'peso_kg', '')::numeric else r.peso_kg end,
      nota      = case when p ? 'nota' then nullif(btrim(coalesce(p ->> 'nota', '')), '') else r.nota end,
      frecuente = coalesce((p ->> 'frecuente')::boolean, r.frecuente),
      activo    = coalesce((p ->> 'activo')::boolean, r.activo),
      orden     = coalesce((p ->> 'orden')::smallint, r.orden),
      updated_at = now(), updated_by = auth.uid()
    where id = v_id returning * into r;
  end if;
  if r.frecuente then update public.empaques set frecuente = false where id <> r.id and frecuente; end if;   -- una sola "más usada"
  perform public.log_audit('Empaque guardado', r.nombre, left(p::text, 500), case when public.auth_role() = 'admin' then 'Dirección' else 'Almacén' end);
  return jsonb_build_object('id', r.id, 'nombre', r.nombre, 'tipo', r.tipo, 'largo_cm', r.largo_cm, 'ancho_cm', r.ancho_cm, 'alto_cm', r.alto_cm, 'peso_kg', r.peso_kg, 'nota', r.nota, 'frecuente', r.frecuente, 'activo', r.activo, 'orden', r.orden);
end;
$$;

alter function public.empaques_lista(boolean) owner to postgres;
alter function public.empaque_guardar(jsonb) owner to postgres;
revoke all on function public.empaques_lista(boolean), public.empaque_guardar(jsonb) from public, anon;
grant execute on function public.empaques_lista(boolean), public.empaque_guardar(jsonb) to authenticated;

do $post$ begin
  if (select count(*) from public.empaques) <> 13 or (select count(*) from public.empaques where frecuente) <> 1 then raise exception 'EMPAQUES: la semilla no quedó'; end if;
  if has_table_privilege('authenticated', 'public.empaques', 'select') or has_function_privilege('anon', 'public.empaques_lista(boolean)', 'execute') then raise exception 'EMPAQUES: permisos inesperados'; end if;
end $post$;
