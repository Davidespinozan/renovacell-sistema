-- W1 · El rollback (99_down.sql) restaura EXACTAMENTE producción. Corre en una
-- transacción y se revierte: no deja la BD de pruebas sin W1.
-- Hashes = md5(pg_get_functiondef) / políticas / grants leídos de PRODUCCIÓN (solo lectura).
begin;
-- Rollback EN CAPAS: cada ola se apoya en objetos de la anterior (W2-C usa
-- v_order_money de W2; W2 usa stock_returns de W1), así que se baja en orden
-- inverso al de aplicación. Ese es el orden real de una reversión.
-- W5 agregó un índice sobre orders (tabla que este archivo compara contra producción
-- previa a W1): es la capa más reciente, así que baja primero.
\ir ../../../rollback/w5/99_down.sql
\ir ../../../rollback/w2c/00_w2_snapshot.sql
\ir ../../../rollback/w2c/99_down.sql
\ir ../../../rollback/w2/99_down.sql
\ir ../../../rollback/w1/99_down.sql
do $t$
declare r record;
begin
  for r in select * from (values
    ('apply_lot_movement(uuid,integer,text,text)',                                    'a5ae7487915fe77b5bae7a8f2c50f93e'),
    ('importar_lote(text,text,text,integer,text)',                                    'af554eae9e3b2d36abd0b7d71f05fcb2'),
    ('orders_guard()',                                                                '9b99aea5e2ef49d63bb9f435b0b36343'),
    ('recibir_lote(uuid,text,text,integer,text,numeric,text,text,uuid)',              '70f03fa22e1fc4f3bd755820f1fec4b6'),
    ('registrar_devolucion(uuid,text,numeric,text,text,jsonb)',                       'ad2d46a465ab3b03c14a6c90de4d8ee9'),
    ('surtir_pedido(uuid,text,jsonb,jsonb)',                                          'f35a934ca88d1e50973ae97740db7242'),
    ('vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid)',  '958293cecfecdc569d6215bf8d2d309f')
  ) as t(sig, h) loop
    perform tests.eq(md5(pg_get_functiondef(('public.' || r.sig)::regprocedure)), r.h, 'rollback restaura igual a prod: ' || r.sig);
  end loop;
  perform tests.eq((select md5(string_agg(tablename||'|'||policyname||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' order by tablename, policyname))
                      from pg_policies where schemaname = 'public'
                       and tablename in ('lots','inventory_movements','replenishments','order_items','orders','shipping_attempts','refunds','shipments')),
                   -- re-anclado CX-0b (136): sin política orders_insert_scoped ni INSERT de authenticated en orders (ajeno a W1/W2; no se restaura con su rollback)
                   '3832889bf506f3aec4dba4db18ecc80f', 'rollback restaura las políticas RLS igual a prod');
  perform tests.eq((select md5(string_agg(table_name||'|'||grantee||'|'||privilege_type, E'\n' order by table_name, grantee, privilege_type))
                      from information_schema.role_table_grants where table_schema = 'public'
                       and table_name in ('lots','inventory_movements','replenishments','order_items','orders','shipping_attempts')
                       and grantee in ('anon','authenticated')),
                   -- CC-0B (autorizado): la higiene de privilegios (anon sin grants, sin TRUNCATE/REFERENCES/
                   -- TRIGGER, escrituras solo con política) se conserva aunque se baje W1: el rollback de W1
                   -- nunca volvió a conceder esos privilegios (eran defaults del esquema). Hash re-anclado.
                   '8cd801e510fa42d0371727647540a92f', 'rollback restaura los GRANT de tabla igual a prod (post CC-0B)');
  -- Estado de constraints / índices / columnas de las tablas W1 = producción (hash leído de prod)
  perform tests.eq((select convalidated::text || '|' || pg_get_constraintdef(oid) from pg_constraint where conname = 'lots_quantity_nonneg'),
                   'false|CHECK ((quantity >= 0)) NOT VALID', 'rollback: lots_quantity_nonneg vuelve a NOT VALID como en prod');
  perform tests.eq((select md5(string_agg(conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid)||'|'||convalidated, E'\n' order by conrelid::regclass::text, conname))
                      from pg_constraint where connamespace = 'public'::regnamespace
                       and conrelid::regclass::text in ('lots','inventory_movements','replenishments','orders','order_items','shipping_attempts')),
                   '66bf409aa7ed82ff929b84aae95e2293', 'rollback: constraints (definición + estado de validación) igual a prod');
  perform tests.eq((select md5(string_agg(c.relname||'|'||i.relname||'|'||pg_get_indexdef(i.oid), E'\n' order by c.relname, i.relname))
                      from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
                     where c.relnamespace = 'public'::regnamespace
                       and c.relname in ('lots','inventory_movements','replenishments','orders','order_items','shipping_attempts')),
                   -- re-anclado: + uq_orders_external_ref (20261031130000 folio del servidor), ajeno a W1 y no se retira con W1
                   'b08662eb9cb422aaab3599e13b0afa62', 'rollback: índices igual a prod');
  perform tests.eq((select md5(string_agg(table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,''), E'\n' order by table_name, column_name))
                      from information_schema.columns where table_schema = 'public'
                       and table_name in ('lots','inventory_movements','replenishments','orders','order_items','shipping_attempts')),
                   '4b3b21731f9556d268c3beb82aa663f4', 'rollback: columnas (tipo, nulabilidad, default) igual a prod');
  perform tests.ok(to_regclass('public.inventory_operations') is null and to_regclass('public.stock_returns') is null, 'rollback elimina las tablas W1');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'inventory_movements' and column_name = 'op_id'), 'rollback elimina columnas W1 del kardex');
end
$t$;
rollback;
