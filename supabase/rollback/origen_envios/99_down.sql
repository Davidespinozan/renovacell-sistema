-- ORIGEN DE ENVÍOS ESTRUCTURADO · rollback de la 183: se retiran el trigger y las 5 columnas nuevas. `shipping_address`
-- conserva el último valor armado (DHL sigue igual). Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop trigger if exists trg_origen_envios_sync on public.company_settings;
drop function public._origen_envios_sync();
alter table public.company_settings drop column shipping_street, drop column shipping_ext_number, drop column shipping_int_number, drop column shipping_colonia, drop column shipping_references;
comment on column public.company_settings.shipping_address is null;
