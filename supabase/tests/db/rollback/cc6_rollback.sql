-- CC-6 · El rollback retira revisiones/operaciones/eventos/comandos sin tocar CC-5 ni W1.
begin;
\ir ../../../rollback/entrega_servicio/99_down.sql   -- PAQUETERÍA AL VENDER (20270314) parcha _entrega_normalizar y el checkout: se baja antes
\ir ../../../rollback/link_pago/99_down.sql   -- LINK DE PAGO (20270309) redefine el push de avisos y usa helpers de pedido por WhatsApp: se baja antes
\ir ../../../rollback/adopcion_portal/99_down.sql   -- ADOPCIÓN (20270308) redefine el cierre de la verificación y la confirmación por WhatsApp: se baja antes de la foto inicial
\ir ../../../rollback/pedido_wa/99_down.sql   -- PEDIDO-WA (20270307) redefine el disparador de alertas y cuelga de la identidad del canal: se baja antes de la foto inicial
\ir ../../../rollback/verificacion_wa/99_down.sql   -- VERIFICACIÓN-WA (20270306) redefine la carga del push de alertas: se baja antes de la foto inicial
\ir ../../../rollback/aviso_ruidoso/99_down.sql   -- AVISO-RUIDOSO (20270305) cuelga de notifications.kind y cc_messages: se baja antes de la foto inicial
\ir ../../../rollback/asesor_retoma/99_down.sql   -- RETOMA (20270304) cuelga de conversaciones y mensajes: se baja antes de la foto inicial
set app.chatv2c1_rollback_forzado = 'on';   -- prueba estructural de la cadena completa (la frontera se prueba en chatv2c1_rollback.sql)
set app.entrega_rollback_forzado = 'on';   -- prueba estructural de la cadena (la guarda de datos se prueba en entrega_pedido_rollback.sql)
\ir ../../../rollback/reparto_asesores/99_down.sql   -- REPARTO (181) se baja primero (redefine _cc_rutear/evaluador/_cc_atencion/config_ver/iniciar/resumen)
\ir ../../../rollback/entrega_paridad/99_down.sql   -- ENT-P se baja antes que ENT-H (redefine _entrega_normalizar)
\ir ../../../rollback/entrega_horarios/99_down.sql   -- ENT-H (189) se baja primero (redefine normalizar/aplicar/checkout y añade columnas a entrega_config)
\ir ../../../rollback/entrega_pedido/99_down.sql   -- ENTREGA (171) se baja primero (redefine el checkout y añade columnas)
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
