-- LIMPIEZA ODOO · REVERSA de scripts/clientes-limpieza-odoo.sql (datos).
-- Reactiva SOLO a los clientes cuya ÚLTIMA baja fue la de la limpieza de Odoo y siguen de baja; deja constancia en su
-- historial (la bitácora es solo-agregar). Las notas de clientes-notas-direcciones-odoo.sql se conservan (las notas son
-- solo-agregar y no estorban). Si ya corrió cartera-odoo-asignar.sql no importa: los dados de baja no se asignaron.
-- Correr en UNA transacción:  psql "$PGURL" -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/clientes-limpieza-odoo-revertir.sql
create temp table _reactivar on commit drop as
  select c.id from public.customers c
   where not c.active
     and (select e.detalle ->> 'origen' from public.customer_events e where e.customer_id = c.id and e.tipo in ('cliente_baja', 'cliente_reactivado')
           order by e.created_at desc, e.id desc limit 1) = 'limpieza_odoo';

update public.customers c set active = true, updated_at = now() from _reactivar r where c.id = r.id;
insert into public.customer_events (customer_id, tipo, detalle, actor_profile_id, actor_rol)
  select id, 'cliente_reactivado', jsonb_build_object('motivo', 'Reversa de la limpieza de Odoo', 'origen', 'limpieza_odoo_reversa'), null, 'direccion' from _reactivar;

do $post$ begin
  raise notice 'LIMPIEZA-ODOO revertida: % reactivados', (select count(*) from _reactivar);
end $post$;
