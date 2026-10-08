-- CC-6 · El rollback retira revisiones/operaciones/eventos/comandos sin tocar CC-5 ni W1.
begin;
set app.chatv2c1_rollback_forzado = 'on';   -- prueba estructural de la cadena completa (la frontera se prueba en chatv2c1_rollback.sql)
\ir ../../../rollback/cartera_p1/99_down.sql   -- CARTERA-P1 (131) se baja primero
\ir ../../../rollback/chatv2d1/99_down.sql   -- CHAT V2-D1 (130) se baja primero
\ir ../../../rollback/ci1/99_down.sql   -- Commercial Intent CI-1 (128) se baja primero
\ir ../../../rollback/chatv2c2/99_down.sql   -- Chat V2-C2 (127) se baja primero
\ir ../../../rollback/chatv2c1/99_down.sql   -- Chat V2-C1 (125) se baja primero
\ir ../../../rollback/chv2a_cron/99_down.sql   -- CHV2-A cron fix (124) se baja primero
\ir ../../../rollback/chv2a/99_down.sql   -- CHV2-A (123) se baja primero
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
