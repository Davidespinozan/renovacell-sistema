-- FOLIO · rollback (en capas: CC-6 depende de siguiente_folio y baja primero).
begin;
set app.entrega_rollback_forzado = 'on';   -- prueba estructural de la cadena (la guarda de datos se prueba en entrega_pedido_rollback.sql)
\ir ../../../rollback/entrega_horarios/99_down.sql   -- ENT-H (189) se baja primero (redefine normalizar/aplicar/checkout y añade columnas a entrega_config)
\ir ../../../rollback/entrega_pedido/99_down.sql   -- ENTREGA (171) se baja primero (redefine el checkout y añade columnas)
\ir ../../../rollback/cc6/99_down.sql
\ir ../../../rollback/folio/99_down.sql
do $t$
begin
  perform tests.ok(to_regprocedure('public.siguiente_folio()') is null and to_regclass('public.orders_folio_seq') is null and not exists (select 1 from pg_indexes where indexname = 'uq_orders_external_ref'), 'folio retirado');
  perform tests.ok(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) !~ 'siguiente_folio' and pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) ~ 'precio_de\(pid, list, q\)', 'crear_pedido vuelve al texto de volume pricing');
  perform tests.ok(has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'EXECUTE'), 'privilegios iguales');
end $t$;
rollback;
