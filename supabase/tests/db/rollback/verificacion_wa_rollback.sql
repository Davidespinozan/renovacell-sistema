-- VERIFICACIÓN POR WHATSAPP (20270306) · el down retira lo nuevo y regresa la carga del push; se reaplica idéntica.
begin;
\ir ../../../rollback/entrega_servicio/99_down.sql   -- PAQUETERÍA AL VENDER (20270314) parcha _entrega_normalizar y el checkout: se baja antes
\ir ../../../rollback/reparto_turno/99_down.sql   -- REPARTO-TURNO (20270312) redefine reparto, responsable y permisos de promociones: se baja antes
\ir ../../../rollback/link_pago/99_down.sql   -- LINK DE PAGO (20270309) redefine el push de avisos y usa helpers de pedido por WhatsApp: se baja antes
\ir ../../../rollback/adopcion_portal/99_down.sql   -- ADOPCIÓN (20270308) redefine el cierre de la verificación y la confirmación por WhatsApp: se baja antes de la foto inicial
\ir ../../../rollback/pedido_wa/99_down.sql   -- PEDIDO-WA (20270307) redefine el disparador de alertas y cuelga de la identidad del canal: se baja antes de la foto inicial
create temp table _vw as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/verificacion_wa/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_solicitudes_alta') is null and to_regprocedure('public.cc_senal_interes(uuid,text)') is null
               and pg_get_functiondef('public.aviso_push_carga(uuid)'::regprocedure) not like '%senal_compra%', 'VERIFICACIÓN-WA down · como la 20270305');
end $t$;
\ir ../../../migrations/20270306120000_verificacion_wa.sql
do $t$ begin
  perform tests.ok((select todas from _vw) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'VERIFICACIÓN-WA · se reaplica idéntica');
end $t$;
rollback;
