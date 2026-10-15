-- CHAT PRO (161) · el down retira columna, tabla y comandos sin tocar nada más; se reaplica igual.
begin;
create temp table _cp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('cc_escribiendo', 'cc_enlace_candidatos', 'cc_enlace_unir', '_tel10', 'cc_respuesta_guardar', 'cc_respuesta_borrar')) resto;
\ir ../../../rollback/chat_pro/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_respuestas_rapidas') is null
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cc_participants' and column_name = 'escribiendo_hasta')
    and (select resto from _cp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '161 down · sin columna, tabla ni comandos; nada más cambió');
end $t$;
\ir ../../../migrations/20261214120000_chat_pro.sql
do $t$ begin
  perform tests.ok((select todas from _cp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '161 · se reaplica idéntica');
end $t$;
rollback;
