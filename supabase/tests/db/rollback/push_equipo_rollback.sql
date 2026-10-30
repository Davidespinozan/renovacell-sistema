-- PUSH DEL EQUIPO (20270220) + PUSH SIEMPRE (20270221) · los downs retiran triggers y funciones sin tocar nada más; se reaplican idénticas.
begin;
create temp table _pe as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/push_estado/99_down.sql
\ir ../../../rollback/push_equipo/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.push_estado_cuentas()') is null and to_regprocedure('public.equipo_push_carga(text,uuid)') is null
               and not exists (select 1 from pg_trigger where tgname in ('equipo_push_mensaje', 'equipo_push_aviso')), 'PUSH EQUIPO down · sin triggers ni funciones');
end $t$;
\ir ../../../migrations/20270220120000_push_equipo.sql
\ir ../../../migrations/20270221120000_push_estado.sql
do $t$ begin
  perform tests.ok((select todas from _pe) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'PUSH EQUIPO · se reaplica idéntica');
end $t$;
rollback;
