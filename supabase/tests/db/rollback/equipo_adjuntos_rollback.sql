-- EQUIPO-ADJUNTOS (20270323) · el down regresa el chat de solo texto; se reaplica idéntica.
begin;
create temp table _ea as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/equipo_adjuntos/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'messages' and column_name = 'adjunto')
                   and not exists (select 1 from storage.buckets where id = 'equipo')
                   and position('_equipo_texto_msg' in pg_get_functiondef('public.equipo_push_carga(text,uuid)'::regprocedure)) = 0, 'EQUIPO-ADJUNTOS down · como antes');
end $t$;
\ir ../../../migrations/20270323120000_equipo_adjuntos.sql
do $t$ begin
  perform tests.ok((select todas from _ea) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'EQUIPO-ADJUNTOS · se reaplica idéntica');
end $t$;
rollback;
