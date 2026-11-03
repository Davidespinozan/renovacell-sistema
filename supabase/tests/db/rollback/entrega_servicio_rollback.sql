-- PAQUETERÍA ELEGIDA AL VENDER (20270314) · el down regresa _entrega_normalizar y quita cotizaciones; se reaplica idéntica.
begin;
create temp table _es as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/entrega_servicio/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.entrega_cotizaciones') is null and pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure) not like '%_entrega_servicio%', 'SERVICIO down · como antes');
end $t$;
\ir ../../../migrations/20270314120000_entrega_servicio.sql
do $t$ begin
  perform tests.ok((select todas from _es) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'SERVICIO · se reaplica idéntica');
end $t$;
rollback;
