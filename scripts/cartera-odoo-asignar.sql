-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CARTERA ODOO · ASIGNACIÓN INICIAL DE CLIENTES A SU VENDEDOR (datos, no esquema)
--   Decisión del dueño (15 oct 2026):
--     · "ROBERTO ANGEL IBARRA ESPINOZA" (Odoo) = Roberto Ibarra    → sus 1,250 clientes reales.
--     · "Alejandra Cazarez Bojorquez"   (Odoo) = Alejandra Carazarez → sus 588 clientes reales.
--     (Odoo traía 1,384 y 813, contando direcciones de entrega como clientes: va DESPUÉS de clientes-limpieza-odoo.sql,
--      que las da de baja; si la limpieza no ha corrido, este script se detiene por los números.)
--     · Antonio Gallardo (152), Jackynoly (5), "Facturacion" (3), Alberto Gutierrez (2) y sin vendedor (212):
--       SIN vendedor (los atiende Dirección; se asignan después uno por uno en Clientes).
--   Escribe lo mismo que el comando de Dirección (cliente_vendedor_asignar) por cada cliente: la cartera por cliente,
--   su historial y el evento del cliente; y registra las dos equivalencias de la cartera histórica con su evento.
--   Solo clientes ACTIVOS, SIN cuenta en el portal y SIN vendedor asignado: nunca pisa una asignación existente.
--   Correr en UNA transacción:  psql "$PGURL" -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/cartera-odoo-asignar.sql
--   Reversa: scripts/cartera-odoo-revertir.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
declare r record;
begin
  for r in select * from (values ('5e21090d-d4ac-4ac9-8652-5140b4edf2d2'::uuid, 'Roberto Ibarra', 'ROBERTO ANGEL IBARRA ESPINOZA', 1250),
                                 ('8feaff73-d2e2-48a6-a767-ace00d9738f2'::uuid, 'Alejandra Carazarez', 'Alejandra Cazarez Bojorquez', 588)) v(id, nombre, odoo, esperados) loop
    if not exists (select 1 from public.profiles p where p.id = r.id and p.role_id = 'pos' and p.active and coalesce(p.meta ->> 'name', p.full_name) = r.nombre) then
      raise exception 'CARTERA-ODOO: % no es un perfil de ventas activo con ese nombre', r.nombre;
    end if;
    if not public._cc_vendedor_elegible(r.id, true) then
      raise exception 'CARTERA-ODOO: % no puede recibir clientes: actívale "Atender conversaciones" y "Recibir clientes nuevos" en Atención comercial', r.nombre;
    end if;
    if (select count(*) from public.customers c where c.seller_name = r.odoo and c.active and c.profile_id is null) <> r.esperados then
      raise exception 'CARTERA-ODOO: % no tiene % clientes activos (¿ya corrió clientes-limpieza-odoo.sql?); revisar antes de asignar', r.odoo, r.esperados;
    end if;
    if exists (select 1 from public.cc_cartera_clientes k join public.customers c on c.id = k.customer_id where c.seller_name = r.odoo) then
      raise exception 'CARTERA-ODOO: ya hay clientes de % con vendedor asignado; esta asignación inicial ya corrió o alguien asignó a mano', r.odoo;
    end if;
    if exists (select 1 from public.cc_cartera_historica_equivalencias e where e.seller_name_odoo = r.odoo and e.seller_profile_id <> r.id) then
      raise exception 'CARTERA-ODOO: la equivalencia de % apunta a otra persona', r.odoo;
    end if;
  end loop;
end $pre$;

create temp table _cartera_odoo on commit drop as
  select c.id as customer_id,
         case c.seller_name when 'ROBERTO ANGEL IBARRA ESPINOZA' then '5e21090d-d4ac-4ac9-8652-5140b4edf2d2'::uuid
                            when 'Alejandra Cazarez Bojorquez'   then '8feaff73-d2e2-48a6-a767-ace00d9738f2'::uuid end as seller
    from public.customers c
   where c.seller_name in ('ROBERTO ANGEL IBARRA ESPINOZA', 'Alejandra Cazarez Bojorquez') and c.active and c.profile_id is null
     and not exists (select 1 from public.cc_cartera_clientes k where k.customer_id = c.id);

insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo)
  select customer_id, seller, now(), null, 'Asignación inicial desde Odoo (autorizada por el dueño, 15 oct 2026)' from _cartera_odoo;
insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
  select customer_id, null, seller, null, 'Asignación inicial desde Odoo (autorizada por el dueño, 15 oct 2026)' from _cartera_odoo;
insert into public.customer_events (customer_id, tipo, detalle, actor_profile_id, actor_rol)
  select customer_id, 'vendedor_asignado', jsonb_build_object('vendedor', seller, 'anterior', null, 'por', 'cliente', 'origen', 'odoo'), null, 'direccion' from _cartera_odoo;

insert into public.cc_cartera_historica_equivalencias (seller_name_odoo, seller_profile_id, autorizado_por, motivo)
  values ('ROBERTO ANGEL IBARRA ESPINOZA', '5e21090d-d4ac-4ac9-8652-5140b4edf2d2', null, 'Confirmada por el dueño (15 oct 2026)'),
         ('Alejandra Cazarez Bojorquez',   '8feaff73-d2e2-48a6-a767-ace00d9738f2', null, 'Confirmada por el dueño (15 oct 2026)')
  on conflict (seller_name_odoo) do nothing;
insert into public.cc_cartera_historica_eventos (accion, seller_name_odoo, seller_anterior, seller_nuevo, actor_profile_id, motivo)
  values ('equivalencia_guardada', 'ROBERTO ANGEL IBARRA ESPINOZA', null, '5e21090d-d4ac-4ac9-8652-5140b4edf2d2', null, 'Confirmada por el dueño (15 oct 2026)'),
         ('equivalencia_guardada', 'Alejandra Cazarez Bojorquez',   null, '8feaff73-d2e2-48a6-a767-ace00d9738f2', null, 'Confirmada por el dueño (15 oct 2026)');

do $post$
declare n_rob int; n_ale int;
begin
  select count(*) filter (where seller_profile_id = '5e21090d-d4ac-4ac9-8652-5140b4edf2d2'), count(*) filter (where seller_profile_id = '8feaff73-d2e2-48a6-a767-ace00d9738f2')
    into n_rob, n_ale from public.cc_cartera_clientes where motivo = 'Asignación inicial desde Odoo (autorizada por el dueño, 15 oct 2026)';
  if n_rob <> 1250 or n_ale <> 588 then raise exception 'CARTERA-ODOO: se asignaron % a Roberto y % a Alejandra (se esperaban 1250 y 588)', n_rob, n_ale; end if;
  if (select count(*) from public.cc_cartera_historica_equivalencias where seller_name_odoo in ('ROBERTO ANGEL IBARRA ESPINOZA', 'Alejandra Cazarez Bojorquez')) <> 2 then
    raise exception 'CARTERA-ODOO: faltan equivalencias';
  end if;
  raise notice 'CARTERA-ODOO OK: Roberto % · Alejandra % · equivalencias 2', n_rob, n_ale;
end $post$;
