-- ALMACÉN CON CONTROL TOTAL + CATÁLOGO SIN PRECIOS (19 nov 2026, dueño: «Alberto debe poder corregir inventario,
-- corregir caducidad, etc.; él hace todas esas cosas, debe tener control total sobre inventario y almacén» y «doctor sin
-- verificación no ve precios»).
--   1. Almacén (warehouse) puede, igual que Dirección:
--      · recibir mercancía SIN compra registrada o un EXCEDENTE (antes solo Dirección: Alberto no podía cargar nada);
--      · corregir el conteo HACIA ARRIBA (sobrantes) y la corrección de recepción;
--      · hacer la CARGA INICIAL por Importar.
--   2. corregir_lote: corrige la CADUCIDAD y/o el CÓDIGO de un lote mal capturado (no existía ni para Dirección). Queda en
--      la bitácora lote_correcciones: antes, después, motivo, quién y cuándo.
--   3. products_safe: el doctor SIN verificar ve el catálogo (nombre, foto, descripción) con el PRECIO vacío; antes veía
--      la tienda vacía. Los precios siguen solo para verificados.
do $pre$ begin
  if position('  elsif v_role <> ''admin'' then' in pg_get_functiondef('public.recibir_lote(uuid,uuid,text,date,integer,uuid,text,numeric,text,text)'::regprocedure)) = 0
     or position('    if v_role <> ''admin'' then' in pg_get_functiondef('public.ajustar_lote(uuid,uuid,integer,text,text,uuid)'::regprocedure)) = 0
     or position('if public.auth_role() <> ''admin'' then' in pg_get_functiondef('public.importar_lote(uuid,text,text,text,integer)'::regprocedure)) = 0 then
    raise exception 'ALMACEN-CONTROL: cambiaron las funciones de inventario; revisar los parches'; end if;
end $pre$;

-- ── 1. Permisos de Almacén ───────────────────────────────────────────────────────────────────────────
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.recibir_lote(uuid,uuid,text,date,integer,uuid,text,numeric,text,text)'::regprocedure);
  execute replace(d, '  elsif v_role <> ''admin'' then', '  elsif v_role not in (''admin'', ''warehouse'') then');
  d := pg_get_functiondef('public.ajustar_lote(uuid,uuid,integer,text,text,uuid)'::regprocedure);
  execute replace(d, '    if v_role <> ''admin'' then', '    if v_role not in (''admin'', ''warehouse'') then');
  d := pg_get_functiondef('public.importar_lote(uuid,text,text,text,integer)'::regprocedure);
  execute replace(d, 'if public.auth_role() <> ''admin'' then', 'if public.auth_role() not in (''admin'', ''warehouse'') then');
end $patch$;

-- ── 2. Corregir caducidad / código de lote ───────────────────────────────────────────────────────────
create table if not exists public.lote_correcciones (
  id         bigint generated always as identity primary key,
  lot_id     uuid not null references public.lots(id) on delete cascade,
  antes      jsonb not null,
  despues    jsonb not null,
  motivo     text not null check (length(btrim(motivo)) between 3 and 300),
  por        uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.lote_correcciones enable row level security;
revoke all on public.lote_correcciones from public, anon, authenticated;
grant select on public.lote_correcciones to service_role;

create or replace function public.corregir_lote(p_lot uuid, p_caducidad date, p_lote text, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare l public.lots; v_code text := nullif(regexp_replace(btrim(coalesce(p_lote, '')), '\s+', ' ', 'g'), ''); v_mot text := btrim(coalesce(p_motivo, ''));
begin
  if public.auth_role() not in ('admin', 'warehouse') then raise exception 'NO_AUTORIZADO: solo Almacén o Dirección corrigen lotes' using errcode = 'insufficient_privilege'; end if;
  if length(v_mot) < 3 then raise exception 'MOTIVO_REQUERIDO: escribe por qué se corrige (p. ej. «la caja dice 2027, se capturó 2207»)' using errcode = 'check_violation'; end if;
  select * into l from public.lots where id = p_lot for update;
  if not found then raise exception 'LOTE_INEXISTENTE' using errcode = 'check_violation'; end if;
  if p_caducidad is null and v_code is null then raise exception 'SIN_CAMBIOS: indica la caducidad o el código correcto' using errcode = 'check_violation'; end if;
  if p_caducidad is not null and (p_caducidad < date '2000-01-01' or p_caducidad > date '2100-12-31') then
    raise exception 'CADUCIDAD_INVALIDA: revisa el año de la caducidad' using errcode = 'check_violation'; end if;
  if v_code is not null and (length(v_code) > 60) then raise exception 'LOTE_INVALIDO: el código es muy largo' using errcode = 'check_violation'; end if;
  if v_code is not null and exists (select 1 from public.lots x where x.product_id = l.product_id and x.id <> l.id
                                       and x.lot_code_norm = lower(regexp_replace(btrim(v_code), '\s+', ' ', 'g'))) then
    raise exception 'LOTE_DUPLICADO: ya existe otro lote con ese código para este producto' using errcode = 'unique_violation'; end if;
  insert into public.lote_correcciones (lot_id, antes, despues, motivo, por)
  values (l.id, jsonb_build_object('caducidad', l.expiry_date, 'lote', l.lot_code),
          jsonb_build_object('caducidad', coalesce(p_caducidad, l.expiry_date), 'lote', coalesce(v_code, l.lot_code)), left(v_mot, 300), auth.uid());
  update public.lots set expiry_date = coalesce(p_caducidad, expiry_date), lot_code = coalesce(v_code, lot_code),
         caducidad_avisada_at = case when p_caducidad is not null and p_caducidad is distinct from l.expiry_date then null else caducidad_avisada_at end
   where id = l.id returning * into l;
  return jsonb_build_object('lot_id', l.id, 'caducidad', l.expiry_date, 'lote', l.lot_code);
end;
$$;
revoke all on function public.corregir_lote(uuid, date, text, text) from public, anon;
grant execute on function public.corregir_lote(uuid, date, text, text) to authenticated;

-- ── 3. Catálogo sin precios para el doctor sin verificar ────────────────────────────────────────────
create or replace view public.products_safe as
 select id, sku, name, line, category, description,
        case when public.auth_role() <> 'doctor' or public.is_verified() then price end as price,
        unit, image_url, active, show_landing, show_portal, family, parent_product_id, sellable
   from public.products
  where auth.uid() is not null;

do $post$ begin
  if position('''warehouse''' in pg_get_functiondef('public.importar_lote(uuid,text,text,text,integer)'::regprocedure)) = 0
     or to_regprocedure('public.corregir_lote(uuid,date,text,text)') is null then raise exception 'ALMACEN-CONTROL: no quedó aplicada'; end if;
end $post$;
