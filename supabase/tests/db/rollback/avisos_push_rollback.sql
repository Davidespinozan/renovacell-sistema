-- AVISOS PUSH (160) · el down retira tabla y comandos sin tocar nada más; se reaplica igual.
begin;
\ir ../../../rollback/mayoreo_reglas/99_down.sql   -- MAYOREO-REGLAS (20270222) redefine precio y cobro: se baja antes de la foto inicial
\ir ../../../rollback/push_estado/99_down.sql   -- PUSH SIEMPRE (20270221) lee la tabla de avisos: se baja antes de la foto inicial
\ir ../../../rollback/push_equipo/99_down.sql   -- PUSH DEL EQUIPO (20270220) también
create temp table _ap as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not like 'push\_%') resto;
\ir ../../../rollback/avisos_push/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.push_suscripciones') is null and (select resto from _ap) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '160 down · sin tabla ni comandos; nada más cambió');
end $t$;
\ir ../../../migrations/20261213120000_avisos_push.sql
do $t$ begin
  perform tests.ok((select todas from _ap) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '160 · se reaplica idéntica');
end $t$;
rollback;
