-- ============================================================================
-- COMPRA A PROVEEDOR CON SU FACTURA (26 nov 2026, dueño: «Dirección hace el pedido, el proveedor manda factura, ellos la
-- meten al sistema y ahí Almacén se entera»; «pudiera ser un PDF también y no debería ser forzoso; se debe poder
-- capturar manualmente»).
--   · Una factura = UNA compra con VARIOS renglones (antes, una compra por producto).
--   · La factura es opcional: XML (se lee exacto), PDF (lo lee la IA y se revisa) o captura a mano. El archivo se guarda
--     como evidencia en el bucket privado «compras».
--   · Cada renglón es una orden de compra normal (replenishments) ligada a la compra: Almacén la ve «por recibir» y la
--     recibe con lote y caducidad como siempre (y avisa a los pedidos sobre pedido).
--   · La misma factura (UUID del CFDI) no se registra dos veces.
--   · Equivalencias proveedor→producto: lo que se elige una vez se recuerda para la siguiente factura de ese proveedor.
-- Rollback: supabase/rollback/compras_con_factura/99_down.sql
-- ============================================================================
create table public.compras (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null,
  proveedor_rfc text,
  factura_folio text,
  factura_uuid text,
  factura_fecha date,
  subtotal numeric, total numeric,
  origen text not null default 'manual' check (origen in ('xml', 'pdf', 'manual')),
  archivo_path text,
  notas text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index uq_compras_factura_uuid on public.compras (upper(factura_uuid)) where factura_uuid is not null;
comment on table public.compras is 'Compra a proveedor (una factura con varios renglones; los renglones son replenishments)';

alter table public.replenishments add column compra_id uuid references public.compras(id) on delete restrict;
create index ix_replenishments_compra on public.replenishments (compra_id) where compra_id is not null;

create table public.compra_equivalencias (
  proveedor_rfc text not null default '',
  clave text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (proveedor_rfc, clave)
);
comment on table public.compra_equivalencias is 'Renglón de factura de proveedor (clave o descripción normalizada) → producto del catálogo';

alter table public.compras enable row level security;
alter table public.compra_equivalencias enable row level security;
create policy compras_leer on public.compras for select to authenticated using (public.auth_role() in ('admin', 'billing', 'warehouse', 'packing'));
create policy compra_equiv_leer on public.compra_equivalencias for select to authenticated using (public.auth_role() in ('admin', 'billing'));
revoke insert, update, delete on public.compras, public.compra_equivalencias from authenticated, anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compras', 'compras', false, 10485760, array['application/pdf', 'text/xml', 'application/xml', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy compras_archivos_leer on storage.objects for select to authenticated
  using (bucket_id = 'compras' and public.auth_role() in ('admin', 'billing'));
create policy compras_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'compras' and public.auth_role() in ('admin', 'billing') and split_part(name, '/', 1) = auth.uid()::text);

-- La operación idempotente de alta de compra con factura.
alter table public.inventory_operations drop constraint inventory_operations_kind_check;
alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind = any (array['recepcion', 'carga_inicial', 'cierre_compra', 'ajuste', 'surtido', 'venta_pos', 'cancelacion',
  'reingreso_cancelacion', 'recepcion_devolucion', 'disposicion_devolucion', 'anulacion_guia', 'alta_compra', 'reconciliacion_guia', 'alta_compra_factura']));

-- Normaliza la clave de un renglón de proveedor (para recordar la equivalencia).
create function public._compra_clave(p text)
 returns text language sql immutable set search_path to 'public'
as $function$ select left(regexp_replace(upper(btrim(coalesce(p, ''))), '\s+', ' ', 'g'), 200) $function$;

-- Alta de la compra con todos sus renglones (idempotente por p_op_id).
--   p_compra:    {proveedor, proveedor_rfc?, factura_folio?, factura_uuid?, factura_fecha?, subtotal?, total?, origen?, archivo_path?, notas?}
--   p_renglones: [{product_id, qty, unit_cost, descripcion?, clave?}]
create function public.crear_compra(p_op_id uuid, p_compra jsonb, p_renglones jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := public.auth_role(); v_req jsonb; v_prev jsonb; v_id uuid; v_prov text; v_rfc text; v_uuid text; v_dup text;
  r jsonb; v_prod record; v_qty integer; v_cost numeric; v_n int := 0; v_clave text; v_origen text; v_path text;
begin
  if v_role not in ('admin', 'billing') then raise exception 'NO_AUTORIZADO: las compras a proveedores las registra Dirección o Facturación'; end if;
  v_prov := nullif(btrim(coalesce(p_compra ->> 'proveedor', '')), '');
  if v_prov is null then raise exception 'PROVEEDOR_REQUERIDO: indica el proveedor'; end if;
  if p_renglones is null or jsonb_typeof(p_renglones) <> 'array' or jsonb_array_length(p_renglones) = 0 then raise exception 'RENGLONES_REQUERIDOS: agrega al menos un producto'; end if;
  if jsonb_array_length(p_renglones) > 200 then raise exception 'RENGLONES_DEMASIADOS: máximo 200 renglones'; end if;
  v_rfc := nullif(upper(btrim(coalesce(p_compra ->> 'proveedor_rfc', ''))), '');
  v_uuid := nullif(upper(btrim(coalesce(p_compra ->> 'factura_uuid', ''))), '');
  if v_uuid is not null and v_uuid !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then raise exception 'UUID_INVALIDO: el folio fiscal (UUID) de la factura no es válido'; end if;
  v_origen := coalesce(nullif(p_compra ->> 'origen', ''), 'manual');
  if v_origen not in ('xml', 'pdf', 'manual') then raise exception 'ORIGEN_INVALIDO'; end if;
  v_path := nullif(btrim(coalesce(p_compra ->> 'archivo_path', '')), '');
  if v_path is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'compras' and o.name = v_path) then raise exception 'ARCHIVO_INVALIDO: el archivo de la factura no se subió bien'; end if;

  v_req := jsonb_build_object('compra', p_compra, 'renglones', p_renglones);
  v_prev := public._w1_op_begin(p_op_id, 'alta_compra_factura', v_req);
  if v_prev is not null then return v_prev; end if;

  if v_uuid is not null then
    select coalesce(factura_folio, '') || ' de ' || proveedor || ' (' || to_char(created_at at time zone 'America/Mazatlan', 'DD/MM/YYYY') || ')' into v_dup from public.compras where upper(factura_uuid) = v_uuid;
    if v_dup is not null then raise exception 'COMPRA_DUPLICADA: esa factura ya se registró: %', v_dup using errcode = 'unique_violation'; end if;
  end if;

  insert into public.compras (proveedor, proveedor_rfc, factura_folio, factura_uuid, factura_fecha, subtotal, total, origen, archivo_path, notas, created_by)
  values (v_prov, v_rfc, nullif(btrim(coalesce(p_compra ->> 'factura_folio', '')), ''), v_uuid, nullif(p_compra ->> 'factura_fecha', '')::date,
          nullif(p_compra ->> 'subtotal', '')::numeric, nullif(p_compra ->> 'total', '')::numeric, v_origen, v_path, nullif(btrim(coalesce(p_compra ->> 'notas', '')), ''), auth.uid())
  returning id into v_id;

  for r in select value from jsonb_array_elements(p_renglones) loop
    select id, name into v_prod from public.products where id = nullif(r ->> 'product_id', '')::uuid;
    if v_prod.id is null then raise exception 'PRODUCTO_REQUERIDO: elige el producto del catálogo para «%»', coalesce(r ->> 'descripcion', 'un renglón'); end if;
    v_qty := nullif(r ->> 'qty', '')::numeric::integer;
    v_cost := nullif(r ->> 'unit_cost', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cantidad de «%»', v_prod.name; end if;
    if v_cost is null or v_cost <= 0 then raise exception 'COSTO_INVALIDO: costo unitario de «%»', v_prod.name; end if;
    insert into public.replenishments (product_id, product_name, qty, unit_cost, kind, supplier, status, paid, received_qty, created_by, compra_id)
    values (v_prod.id, v_prod.name, v_qty, v_cost, 'compra', v_prov, 'pendiente', false, 0, auth.uid(), v_id);
    v_n := v_n + 1;
    v_clave := public._compra_clave(coalesce(nullif(r ->> 'clave', ''), r ->> 'descripcion'));
    if v_clave <> '' then
      insert into public.compra_equivalencias (proveedor_rfc, clave, product_id) values (coalesce(v_rfc, ''), v_clave, v_prod.id)
      on conflict (proveedor_rfc, clave) do update set product_id = excluded.product_id, updated_at = now();
    end if;
  end loop;

  insert into public.audit_logs (actor, action, resource_type, resource_id, payload, created_at)
  values (auth.uid(), 'Compra a proveedor', 'app', v_id::text, jsonb_build_object('area', 'Compras', 'detail',
          format('%s · %s renglones%s', v_prov, v_n, coalesce(' · factura ' || nullif(p_compra ->> 'factura_folio', ''), ''))), now());
  return public._w1_op_finish(p_op_id, 'alta_compra_factura', v_req, jsonb_build_object('status', 'applied', 'compra_id', v_id, 'renglones', v_n));
end;
$function$;
revoke all on function public.crear_compra(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.crear_compra(uuid, jsonb, jsonb) to authenticated, service_role;
