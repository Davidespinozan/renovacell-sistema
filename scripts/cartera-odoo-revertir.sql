-- CARTERA ODOO · REVERSA de scripts/cartera-odoo-asignar.sql (datos).
-- Quita SOLO las asignaciones que hizo ese script y que nadie cambió después (mismo motivo, mismo vendedor), deja
-- constancia en el historial y en el evento del cliente (las bitácoras son solo-agregar), y borra las dos equivalencias.
-- Correr en UNA transacción:  psql "$PGURL" -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/cartera-odoo-revertir.sql
create temp table _cartera_odoo_rev on commit drop as
  select customer_id, seller_profile_id as seller from public.cc_cartera_clientes
   where motivo = 'Asignación inicial desde Odoo (autorizada por el dueño, 15 oct 2026)' and asignado_por is null
     and seller_profile_id in ('5e21090d-d4ac-4ac9-8652-5140b4edf2d2', '8feaff73-d2e2-48a6-a767-ace00d9738f2');

delete from public.cc_cartera_clientes k using _cartera_odoo_rev r where k.customer_id = r.customer_id;
insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
  select customer_id, seller, null, null, 'Reversa de la asignación inicial desde Odoo' from _cartera_odoo_rev;
insert into public.customer_events (customer_id, tipo, detalle, actor_profile_id, actor_rol)
  select customer_id, 'vendedor_asignado', jsonb_build_object('vendedor', null, 'anterior', seller, 'por', 'cliente', 'origen', 'odoo_reversa'), null, 'direccion' from _cartera_odoo_rev;

insert into public.cc_cartera_historica_eventos (accion, seller_name_odoo, seller_anterior, seller_nuevo, actor_profile_id, motivo)
  select 'equivalencia_borrada', seller_name_odoo, seller_profile_id, null, null, 'Reversa de la asignación inicial desde Odoo'
    from public.cc_cartera_historica_equivalencias where seller_name_odoo in ('ROBERTO ANGEL IBARRA ESPINOZA', 'Alejandra Cazarez Bojorquez');
delete from public.cc_cartera_historica_equivalencias where seller_name_odoo in ('ROBERTO ANGEL IBARRA ESPINOZA', 'Alejandra Cazarez Bojorquez');

do $post$ begin
  raise notice 'CARTERA-ODOO revertida: % asignaciones quitadas', (select count(*) from _cartera_odoo_rev);
end $post$;
