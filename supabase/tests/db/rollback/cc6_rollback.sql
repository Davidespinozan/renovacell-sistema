-- CC-6 · El rollback retira revisiones/operaciones/eventos/comandos sin tocar CC-5 ni W1.
begin;
\ir ../../../rollback/c360_f3/99_down.sql   -- C360-F3 (121) se baja primero
\ir ../../../rollback/c360_0/99_down.sql   -- C360-0 (120) se baja primero
\ir ../../../rollback/cc7/99_down.sql   -- CC-7 se baja primero (depende de CC-2/5/6)
\ir ../../../rollback/cc6/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_checkout_reviews') is null and to_regclass('public.cc_checkout_operations') is null and to_regclass('public.cc_checkout_events') is null, 'tablas CC-6 retiradas');
  perform tests.ok(to_regprocedure('public.cc_checkout_confirmar(uuid,text,int)') is null and to_regprocedure('public.cc_checkout_revisar(uuid,uuid)') is null and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '\_cc\_chk\_%'), 'funciones CC-6 retiradas');
  perform tests.ok(to_regclass('public.cc_carts') is not null and to_regprocedure('public.cc_carrito_preparar_checkout(uuid,text,text,uuid)') is not null, 'CC-5 intacto');
  perform tests.ok(to_regprocedure('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)') is not null and to_regclass('public.orders') is not null, 'W1 intacto');
  perform tests.ok(not exists (select 1 from pg_class where relname = 'cc_checkout_folio_seq'), 'secuencia retirada');
end $t$;
rollback;
