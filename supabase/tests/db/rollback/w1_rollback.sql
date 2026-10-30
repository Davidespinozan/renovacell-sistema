-- W1 · El rollback (99_down.sql) restaura EXACTAMENTE producción. Corre en una
-- transacción y se revierte: no deja la BD de pruebas sin W1.
-- Hashes = md5(pg_get_functiondef) / políticas / grants leídos de PRODUCCIÓN (solo lectura).
begin;
\ir ../../../rollback/busqueda_compradores/99_down.sql   -- BLOQUE-A (20270214) añade índices a order_items: se bajan antes de comparar con producción
\ir ../../../rollback/pedidos_previos/99_down.sql   -- PEDIDOS-PREVIOS (20270207) se baja primero: esta prueba fija la versión anterior de pertenencia del doctor
\ir ../../../rollback/ensayo_golive/99_down.sql
\ir ../../../rollback/atribucion_pagado/99_down.sql   -- ATRIBUCIÓN-PAGADO (20270203) se baja antes (redefine atribución, cobro, evaluador y políticas)
\ir ../../../rollback/auxiliar_almacen/99_down.sql   -- AUXILIAR se baja antes de tomar la foto (redefine recepción, reingreso, custodia y anular_guia)
\ir ../../../rollback/dhl_d1_reconciliacion/99_down.sql   -- DHL D1 (190): columnas de shipping_attempts y tipo de operación en inventory_operations; se baja primero
\ir ../../../rollback/cs1a7_cierre_manual/99_down.sql   -- CS-1A.7 (187)
\ir ../../../rollback/cs1a6_reversa/99_down.sql   -- CS-1A.6 (186)
\ir ../../../rollback/cs1b_reserva_guard/99_down.sql   -- CS-1A.1b (185): la guarda vive en payment_entries; se baja antes que 1a
\ir ../../../rollback/cs1a_intentos/99_down.sql   -- CS-1A.1a (184): v_order_disponible depende de payment_entries; se baja primero
-- Rollback EN CAPAS: cada ola se apoya en objetos de la anterior (W2-C usa
-- v_order_money de W2; W2 usa stock_returns de W1), así que se baja en orden
-- inverso al de aplicación. Ese es el orden real de una reversión.
-- W5 agregó un índice sobre orders (tabla que este archivo compara contra producción
-- previa a W1): es la capa más reciente, así que baja primero.
set app.entrega_rollback_forzado = 'on';   -- prueba estructural de la cadena (la guarda de datos se prueba en entrega_pedido_rollback.sql)
\ir ../../../rollback/entrega_paridad/99_down.sql   -- ENT-P se baja antes que ENT-H (redefine _entrega_normalizar)
\ir ../../../rollback/entrega_horarios/99_down.sql   -- ENT-H (189) se baja primero (redefine normalizar/aplicar/checkout y añade columnas a entrega_config)
\ir ../../../rollback/entrega_pedido/99_down.sql   -- ENTREGA (171) se baja primero (redefine el checkout y añade columnas)
\ir ../../../rollback/pos_sin_interbloqueo/99_down.sql   -- 166 (llave de order_items diferida) baja primero
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
                   -- re-anclado CX-0b (136) + CX-0c (137): sin INSERT directo en orders; rama pos de orders_select_scoped por seller_profile_id / _cx0c_venta_pos_propia (ajeno a W1/W2)
                   -- re-anclado SEC-C1 (140): lecturas de POS acotadas al pedido visible (order_items, inventory_movements, refunds, payment_entries, cash_closings); ajeno a W1/W2 — con el down de SEC-C1 aplicado primero el valor vuelve a 83543a5a… (verificado)
                   '2ffad07903ac4d2e04a8003c95ced1af', 'rollback restaura las políticas RLS igual a prod');
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
