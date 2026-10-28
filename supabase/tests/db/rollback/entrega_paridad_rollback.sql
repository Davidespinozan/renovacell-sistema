-- PARIDAD DE REGLAS DE VENTA (ENT-P) · el down devuelve _entrega_normalizar a la 189 (sin cortesía con motivo) y nada más
-- cambia; se reaplica idéntica.
begin;
create temp table _entp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> '_entrega_normalizar') otras;
\ir ../../../rollback/entrega_paridad/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure)) = '7d731bdba48f2dc348350b8469f1e0f8', 'ENT-P down · _entrega_normalizar vuelve a la versión de la 189');
  perform tests.ok((select otras from _entp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> '_entrega_normalizar'),
    'ENT-P down · ninguna otra función cambió');
  perform tests.ok(not has_function_privilege('authenticated', 'public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)', 'execute'), 'ENT-P down · sigue siendo interna');
end $t$;
\ir ../../../migrations/20270128120000_entrega_paridad.sql
do $t$ begin
  perform tests.ok((select todas from _entp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'ENT-P · se reaplica idéntica');
end $t$;
rollback;
