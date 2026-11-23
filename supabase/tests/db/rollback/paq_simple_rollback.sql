-- PAQ-SIMPLE (20270407460000) · el down regresa la regla de «servicio elegido al vender» y quita Estafeta; se reaplica idéntica.
begin;
create temp table _ps as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/paq_simple/99_down.sql
do $t$ begin
  perform tests.ok(pg_get_functiondef('public.entrega_opciones(text,numeric,text,timestamptz)'::regprocedure) not like '%foraneo_estafeta%'
    and pg_get_functiondef('public._entrega_servicio(jsonb,jsonb,timestamptz)'::regprocedure) like '%v_dif%'
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entrega_config' and column_name like 'estafeta%'), 'PAQ-SIMPLE down · como antes');
end $t$;
\ir ../../../migrations/20270407460000_paq_simple.sql
do $t$ begin
  perform tests.ok((select todas from _ps) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'PAQ-SIMPLE · se reaplica idéntica');
end $t$;
rollback;
