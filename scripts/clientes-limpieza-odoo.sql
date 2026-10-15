-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- LIMPIEZA ODOO · DAR DE BAJA LO QUE NO ES CLIENTE (datos, no esquema). Correr ANTES de cartera-odoo-asignar.sql.
--   Decisión del dueño (15 oct 2026): limpiar antes de asignar vendedores. Se da de BAJA (no se borra): igual que
--   cliente_estado_guardar de Dirección (active = false + evento 'cliente_baja' con su motivo). Reversible.
--     · 403 direcciones de entrega de Odoo importadas como cliente ("CLIENTE, Consultorio", "…, Ocurre DHL"): su
--       cliente "padre" existe con el nombre exacto antes de la coma. Se conservan
--       (solo de baja); clientes-notas-direcciones-odoo.sql deja al padre una nota con ellas.
--     · 15 registros del personal de la empresa (Roberto, Alejandra, Antonio, Alberto, Jackynoly, Kevin, Facturación).
--     · 2 de prueba o sin datos reales ("Usuario Pruebas", "GO" de Colombia).
--   NO toca: PUBLICO GENERAL, Renovacell sa de cv, clientes con cuenta en el portal o con pedidos.
--   Correr en UNA transacción:  psql "$PGURL" -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/clientes-limpieza-odoo.sql
--   Reversa: scripts/clientes-limpieza-odoo-revertir.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
create temp table _baja (id uuid primary key, motivo text not null, tipo text not null) on commit drop;

insert into _baja
  select c.id, left('Dirección de entrega de Odoo importada como cliente; pertenece a «' || btrim(split_part(c.full_name, ',', 1)) || '»', 200), 'direccion_odoo'
    from public.customers c
   where c.active and c.profile_id is null and c.full_name like '%, %'
     and exists (select 1 from public.customers p where p.id <> c.id and p.full_name not like '%, %' and btrim(p.full_name) = btrim(split_part(c.full_name, ',', 1)));
insert into _baja
  select c.id, 'Personal de la empresa importado de Odoo como cliente', 'personal' from public.customers c
   where c.active and c.id in ('b62e1de7-bd8a-4b63-8f83-2db28eda7605','d1a4420d-4de7-4090-87bb-79e0bf79e0f8','690d2de8-0723-47f3-8612-187a7e048614','4c46b782-4f5c-455d-9538-62be3b4e4a08',
     '1a659f7e-9acb-4d4f-a28e-31187f40cafe','01421642-b1ce-4850-960c-e6d69bb113b9','30a9bf92-d461-4a4e-861f-d95b7a48066d','33abe80a-862d-4b14-abe6-afce039f4e0b','617fe55f-95f1-4e86-b864-e57c06b4f5b5',
     'ad7bcccd-a7d0-4e9c-a339-9bf2eb2d2c8d','f795e795-f89a-4788-b8e6-bb3f5e0df86d','17d81956-257c-4e54-9a80-544e14fbde73','4df64152-7bb5-4b55-b338-348a850c1609','6c11c03f-2474-4859-bd3c-8b2048d59f87',
     '2e2aa328-65cd-4117-9ee1-6a53f0ebe4c4','fe889c18-b683-4f72-9329-3e3894a1864a')
     and not exists (select 1 from _baja b where b.id = c.id);
insert into _baja
  select c.id, 'Registro de prueba o sin datos reales importado de Odoo', 'prueba' from public.customers c
   where c.active and c.id in ('ef1b83a2-f9b6-44e0-91aa-1ce93e71d0a9','8ddad202-33c7-4837-af6e-60187c519916','137c220e-22d3-46c9-9647-cd10b1b88d83')
     and not exists (select 1 from _baja b where b.id = c.id);

do $pre$
declare n_dir int; n_per int; n_pru int;
begin
  select count(*) filter (where tipo = 'direccion_odoo'), count(*) filter (where tipo = 'personal'), count(*) filter (where tipo = 'prueba') into n_dir, n_per, n_pru from _baja;
  if n_dir <> 403 or n_per <> 15 or n_pru <> 2 then
    raise exception 'LIMPIEZA-ODOO: se encontraron % direcciones, % de personal y % de prueba (se esperaban 403, 15 y 2); ya corrió o los datos cambiaron', n_dir, n_per, n_pru;
  end if;
  if exists (select 1 from _baja b join public.customers c on c.id = b.id
              where c.profile_id is not null or exists (select 1 from public.orders o where o.customer_id = c.id)
                 or exists (select 1 from public.cc_cartera_clientes k where k.customer_id = c.id)) then
    raise exception 'LIMPIEZA-ODOO: alguno tiene cuenta en el portal, pedidos o vendedor asignado; no se toca nada';
  end if;
end $pre$;

update public.customers c set active = false, updated_at = now() from _baja b where c.id = b.id;
insert into public.customer_events (customer_id, tipo, detalle, actor_profile_id, actor_rol)
  select id, 'cliente_baja', jsonb_build_object('motivo', motivo, 'origen', 'limpieza_odoo'), null, 'direccion' from _baja;

do $post$ begin
  if exists (select 1 from _baja b join public.customers c on c.id = b.id where c.active) then raise exception 'LIMPIEZA-ODOO: quedaron activos'; end if;
  raise notice 'LIMPIEZA-ODOO OK: % dados de baja · activos ahora %', (select count(*) from _baja), (select count(*) from public.customers where active);
end $post$;
