-- REPARTO-VERIF (20270213) · el down devuelve verificación, permiso, evaluador de atención y prerregistro EXACTOS a
-- producción y retira el reparto de verificaciones y su cron; la migración se reaplica idéntica.
begin;
create temp table _rv as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/reparto_verificacion/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_verif_reparto') is null and not exists (select 1 from cron.job where jobname = 'renovacell-verif-reparto'), 'REPARTO-VERIF down · sin tabla ni cron');
  perform tests.ok(md5(pg_get_functiondef('public.verificacion_avisar(uuid)'::regprocedure)) = '38e9e0334c32eca0271fd113c8c4aaa2'
               and md5(pg_get_functiondef('public._puede_verificar(uuid)'::regprocedure)) = 'eacfecba133eb41e6a1e7a1773ba2ee5'
               and md5(pg_get_functiondef('public.cc_atencion_evaluar()'::regprocedure)) = '76cffebc9ab088e6d8de00b52a72d9ad'
               and md5(pg_get_functiondef('public.cc_visitante_prerregistrar(text,text,text,text,boolean,text,boolean)'::regprocedure)) = '53547adb8321ce874bdb8ba2a521f15d', 'REPARTO-VERIF down · funciones idénticas a producción');
end $t$;
\ir ../../../migrations/20270213120000_reparto_verificacion.sql
do $t$ begin
  perform tests.ok((select todas from _rv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'REPARTO-VERIF · se reaplica idéntica');
end $t$;
rollback;
