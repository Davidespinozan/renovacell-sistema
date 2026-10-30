-- VINCULAR-CLIENTE (20270206) · el down devuelve ruteo/nombre/bandeja/cola exactos y quita columna, historial y comandos;
-- la migración se reaplica idéntica.
begin;
\ir ../../../rollback/enlace_vendedor/99_down.sql   -- ENLACE-VENDEDOR (20270211) redefine funciones de esta: se baja antes de la foto inicial
create temp table _vc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/vincular_cliente/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = 'f1c1f37e170e4336fc231cac6077f061'
               and md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) = '666cd0f65aa762aaa2c41fcdcdf0680d'
               and md5(pg_get_functiondef('public.cc_bandeja_unificada(integer)'::regprocedure)) = 'b64ca70badff52647348f163c50bbcab'
               and md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) = '6c82ab2d546e3f7cc22b117a0589e7e7', 'VINCULAR-CLIENTE down · funciones exactas de antes');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'cc_conversations' and column_name = 'customer_id')
               and to_regclass('public.cc_conversacion_cliente_hist') is null, 'VINCULAR-CLIENTE down · sin columna ni historial');
end $t$;
\ir ../../../migrations/20270206120000_vincular_cliente.sql
do $t$ begin
  perform tests.ok((select todas from _vc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'VINCULAR-CLIENTE · se reaplica idéntica');
end $t$;
rollback;
