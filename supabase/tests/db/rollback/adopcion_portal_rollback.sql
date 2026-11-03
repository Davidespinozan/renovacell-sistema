-- ADOPCIÓN DEL PORTAL (20270308) · el down regresa el aviso de aprobación y la confirmación anteriores; se reaplica idéntica.
begin;
\ir ../../../rollback/salida_programada/99_down.sql   -- SALIDA PROGRAMADA (20270320) parcha la regla de entrega y los pedidos del chat: se baja antes
\ir ../../../rollback/entrega_servicio/99_down.sql   -- PAQUETERÍA AL VENDER (20270314) parcha _entrega_normalizar y el checkout: se baja antes
create temp table _ap as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/adopcion_portal/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.adopcion_resumen(int)') is null and to_regprocedure('public.cc_alta_wa_cerrar(uuid,uuid,uuid,uuid)') is not null
               and pg_get_functiondef('public.cc_ia_pedido_confirmar(uuid,uuid)'::regprocedure) not like '%volver a pedir%', 'ADOPCIÓN down · como antes');
end $t$;
\ir ../../../migrations/20270308120000_adopcion_portal.sql
do $t$ begin
  perform tests.ok((select todas from _ap) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'ADOPCIÓN · se reaplica idéntica');
end $t$;
rollback;
