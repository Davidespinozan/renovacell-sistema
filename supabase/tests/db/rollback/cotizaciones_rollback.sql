-- COTIZACIONES (20270209) · el down retira tabla y comandos y devuelve la lista de plantillas; se reaplica idéntica.
begin;
\ir ../../../rollback/mayoreo_reglas/99_down.sql   -- MAYOREO-REGLAS (20270222) redefine precio y cobro: se baja antes de la foto inicial
\ir ../../../rollback/difusiones/99_down.sql   -- DIFUSIONES (20270217) amplía la lista de plantillas del buzón: se baja antes de la foto inicial
create temp table _co as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_comm_plantilla') ck;
\ir ../../../rollback/cotizaciones/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cotizaciones') is null and to_regprocedure('public.cc_cotizacion_crear(uuid,jsonb,text,uuid)') is null
               and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_comm_plantilla') not like '%cotizacion%', 'COTIZACIONES down · sin tabla, comandos ni plantilla');
end $t$;
\ir ../../../migrations/20270209120000_cotizaciones.sql
do $t$ begin
  perform tests.ok((select todas from _co) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select ck from _co) = (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_comm_plantilla'), 'COTIZACIONES · se reaplica idéntica');
end $t$;
rollback;
