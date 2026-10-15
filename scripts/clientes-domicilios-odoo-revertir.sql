-- DOMICILIOS DE ODOO · REVERSA de scripts/clientes-domicilios-odoo.sql (datos).
-- Quita SOLO los domicilios que agregó ese script y que nadie completó ni usó después (sin editar desde que se crearon
-- y sin ningún pedido que los cite). Los completados o usados se quedan. Deja constancia en el historial del cliente.
-- Correr en UNA transacción:  psql "$PGURL" -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/clientes-domicilios-odoo-revertir.sql
create temp table _quitar on commit drop as
  select l.id, l.customer_id from public.doctor_locations l
   where l.id in (select (e.detalle ->> 'domicilio_id')::uuid from public.customer_events e where e.tipo = 'domicilio_agregado' and e.detalle ->> 'origen' = 'odoo')
     and l.updated_at = l.created_at and l.line1 = '' and l.postal_code = ''
     and not exists (select 1 from public.orders o where o.shipping_meta ->> 'location_id' = l.id::text);

delete from public.doctor_locations l using _quitar q where l.id = q.id;
insert into public.customer_events (customer_id, tipo, detalle, actor_profile_id, actor_rol)
  select customer_id, 'domicilio_archivado', jsonb_build_object('domicilio_id', id, 'origen', 'odoo_reversa'), null, 'direccion' from _quitar;

do $post$ begin
  raise notice 'DOMICILIOS-ODOO revertidos: % quitados', (select count(*) from _quitar);
end $post$;
