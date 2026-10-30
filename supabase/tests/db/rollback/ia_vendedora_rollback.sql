-- IA-VENDEDORA (20270223) · el down devuelve el precio de un producto exacto de antes y retira lo nuevo; se reaplica idéntica.
begin;
\ir ../../../rollback/interes_proactivo/99_down.sql   -- INTERÉS PROACTIVO (20270224) cuelga de la actividad del catálogo: se baja antes de la foto inicial
create temp table _iv as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/ia_vendedora/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_ia_cotizar(uuid,jsonb)') is null and to_regclass('public.cc_actividad_catalogo') is null and to_regclass('public.cc_producto_especialidad') is null
               and pg_get_functiondef('public._cc_precio_vol(uuid,uuid,integer,integer)'::regprocedure) not like '%reglas_del_pedido%', 'IA-VENDEDORA down · sin lo nuevo y el precio como antes');
end $t$;
\ir ../../../migrations/20270223120000_ia_vendedora.sql
do $t$ begin
  perform tests.ok((select todas from _iv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'IA-VENDEDORA · se reaplica idéntica');
end $t$;
rollback;
