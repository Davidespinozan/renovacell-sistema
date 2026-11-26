drop function if exists public.crear_compra(uuid, jsonb, jsonb);
drop function if exists public._compra_clave(text);
drop policy if exists compras_archivos_leer on storage.objects;
drop policy if exists compras_archivos_subir on storage.objects;
alter table public.replenishments drop column if exists compra_id;
drop table if exists public.compra_equivalencias;
drop table if exists public.compras;
-- (el bucket «compras» se deja: puede tener archivos)
alter table public.inventory_operations drop constraint inventory_operations_kind_check;
alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind = any (array['recepcion', 'carga_inicial', 'cierre_compra', 'ajuste', 'surtido', 'venta_pos', 'cancelacion',
  'reingreso_cancelacion', 'recepcion_devolucion', 'disposicion_devolucion', 'anulacion_guia', 'alta_compra', 'reconciliacion_guia']));   -- falla si ya hay operaciones alta_compra_factura
