-- AVISO DE VERIFICACIÓN (163) · el down retira los comandos sin tocar nada más; se reaplica igual.
begin;
\ir ../../../rollback/enlace_vendedor/99_down.sql   -- ENLACE-VENDEDOR (20270211) redefine funciones de esta: se baja antes de la foto inicial
create temp table _av as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_vendedor_de_doctor', 'verificacion_avisar', 'mis_por_verificar')) resto;
\ir ../../../rollback/aviso_verificacion/99_down.sql
do $t$ begin
  perform tests.ok((select resto from _av) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '163 down · sin los comandos; nada más cambió');
end $t$;
\ir ../../../migrations/20261216120000_aviso_verificacion.sql
do $t$ begin
  perform tests.ok((select todas from _av) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '163 · se reaplica idéntica');
end $t$;
rollback;
