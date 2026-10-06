-- CC-5 · El rollback retira el carrito y devuelve adopción/purga a CC-2 sin tocar CC-1..CC-4.
begin;
-- CC-6 (revisiones/operaciones → cc_carts) baja primero.
\ir ../../../rollback/c360_f3/99_down.sql   -- C360-F3 (121) se baja primero
\ir ../../../rollback/c360_0/99_down.sql   -- C360-0 (120) se baja primero
\ir ../../../rollback/cc7/99_down.sql   -- CC-7 se baja primero (depende de CC-2/5/6)
\ir ../../../rollback/cc6/99_down.sql
\ir ../../../rollback/cc5/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_carts') is null and to_regclass('public.cc_cart_items') is null and to_regclass('public.cc_cart_operations') is null and to_regclass('public.cc_cart_events') is null, 'tablas de carrito retiradas');
  perform tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'cc\_carrito\_%' or p.proname like '\_cc\_cart\_%' or p.proname = '_cc_adoptar_carritos')), 'funciones CC-5 retiradas');
  perform tests.ok(pg_get_functiondef('public.cc_visitante_adoptar(text,uuid)'::regprocedure) not like '%_cc_adoptar_carritos%' and pg_get_functiondef('public.cc_visitante_adoptar(text,uuid)'::regprocedure) like '%_cc_adoptar_conversaciones%', 'cc_visitante_adoptar vuelve a CC-2');
  perform tests.ok(pg_get_functiondef('public.cc_visitantes_purgar(int)'::regprocedure) not like '%cc_carts%', 'cc_visitantes_purgar vuelve a CC-2');
  perform tests.ok(to_regclass('public.cc_ai_turns') is not null and to_regclass('public.cc_conversations') is not null and to_regprocedure('public.cc_ia_precio(uuid,uuid,int)') is not null, 'CC-2/CC-4 intactos');
  perform tests.ok(has_function_privilege('service_role', 'public.cc_visitante_adoptar(text,uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.cc_visitante_adoptar(text,uuid)', 'EXECUTE'), 'privilegios de adopción iguales');
end $t$;
rollback;
