-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- DOMICILIOS DE ODOO → DOMICILIOS DEL CLIENTE (datos). Correr DESPUÉS de clientes-limpieza-odoo.sql (ya corrió el 15 oct).
--   Odoo guarda cada domicilio extra de un cliente como "contacto hijo" ("CLIENTE, Consultorio", "…, Ocurre DHL").
--   La limpieza dio de baja esos 403 registros (no son clientes). Decisión del dueño (15 oct 2026): pasarlos como
--   DOMICILIOS de su cliente (doctor_locations, igual que «Domicilios» de la ficha).
--   El Excel importado de Odoo NO traía calle ni CP: cada domicilio entra con su alias, tipo, ciudad y teléfono, y con
--   calle y CP vacíos. El sistema ya no deja usar un domicilio incompleto para un pedido (el selector avisa "A esta
--   ubicación le falta: calle y número, código postal…" y no lo acepta; el envío a DHL exige CP): se completa en la ficha
--   antes de usarlo. Ninguno queda como predeterminado.
--   Solo los 401 cuyo cliente sigue activo (2 son de registros de personal/prueba dados de baja). Una sola vez.
--   Correr en UNA transacción:  psql "$PGURL" -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/clientes-domicilios-odoo.sql
--   Reversa: scripts/clientes-domicilios-odoo-revertir.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
create temp table _dom on commit drop as
  with ult as (   -- último cambio de estado de cada cliente
         select distinct on (customer_id) customer_id, detalle ->> 'motivo' as motivo
           from public.customer_events where tipo in ('cliente_baja', 'cliente_reactivado')
          order by customer_id, created_at desc, id desc),
       hijos as (  -- direcciones de Odoo dadas de baja por la limpieza
         select h.*, btrim(substr(h.full_name, strpos(h.full_name, ',') + 1)) as alias, btrim(split_part(h.full_name, ',', 1)) as nombre_padre
           from public.customers h join ult u on u.customer_id = h.id
          where not h.active and h.full_name like '%, %' and u.motivo like 'Dirección de entrega de Odoo importada como cliente%'),
       padres as (  -- el cliente con ese nombre exacto (sin coma); si hubiera varios, el activo más antiguo
         select distinct on (btrim(full_name)) btrim(full_name) as nombre, id
           from public.customers where full_name not like '%, %'
          order by btrim(full_name), active desc, created_at)
  select gen_random_uuid() as id, p.id as padre, left(x.alias, 120) as alias,
         case when x.alias ~* 'consultorio' then 'CONSULTORIO'
              when x.alias ~* '(cl[ií]nica|hospital|sanatorio|m[eé]dic)' then 'CLINICA_HOSPITAL'
              when x.alias ~* '(domicilio|casa|personal|particular)' then 'CASA'
              when x.alias ~* 'oficina' then 'OFICINA'
              when x.alias ~* '(almac[eé]n|bodega)' then 'ALMACEN' else 'OTRO' end as tipo,
         left(coalesce(nullif(btrim(x.city), ''), ''), 120) as city, coalesce(nullif(btrim(x.country), ''), 'México') as country,
         left(nullif(btrim(x.phone), ''), 30) as phone
    from hijos x
    join padres p on p.nombre = x.nombre_padre
    join public.customers k on k.id = p.id and k.active and k.profile_id is null;

do $pre$ begin
  if (select count(*) from _dom) <> 401 or (select count(distinct padre) from _dom) <> 327 then
    raise exception 'DOMICILIOS-ODOO: se esperaban 401 domicilios de 327 clientes (hay % de %)', (select count(*) from _dom), (select count(distinct padre) from _dom);
  end if;
  if exists (select 1 from public.customer_events where tipo = 'domicilio_agregado' and detalle ->> 'origen' = 'odoo') then
    raise exception 'DOMICILIOS-ODOO: ya corrió (hay domicilios agregados desde Odoo)';
  end if;
end $pre$;

insert into public.doctor_locations (id, doctor_id, customer_id, name, tipo, line1, postal_code, city, state, country, contact_phone, is_default, active)
  select id, null, padre, alias, tipo, '', '', city, '', country, phone, false, true from _dom;
insert into public.customer_events (customer_id, tipo, detalle, actor_profile_id, actor_rol)
  select padre, 'domicilio_agregado', jsonb_build_object('domicilio_id', id, 'tipo', tipo, 'origen', 'odoo', 'incompleto', true), null, 'direccion' from _dom;

do $post$ begin
  raise notice 'DOMICILIOS-ODOO OK: % domicilios agregados a % clientes (sin calle ni CP: se completan antes de usarse)',
    (select count(*) from public.doctor_locations l join _dom d on d.id = l.id), (select count(distinct padre) from _dom);
end $post$;
