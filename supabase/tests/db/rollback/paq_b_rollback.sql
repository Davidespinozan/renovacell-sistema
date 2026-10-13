-- PAQ-B (149) · el down elimina anular_guia y restaura _comm_tr_orders exactamente; todo lo demás queda igual.
begin;
create temp table _pb as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('anular_guia', '_comm_tr_orders')) resto,
  (select count(*) from public.shipments) n_s, (select count(*) from public.orders) n_o;
\ir ../../../rollback/paq_b/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from pg_proc where proname = 'anular_guia') and md5(pg_get_functiondef('public._comm_tr_orders()'::regprocedure)) = '6cd538f276621d538be34a2da15c4290', '149 down · sin anular_guia y con _comm_tr_orders idéntica a producción');
  perform tests.ok((select resto from _pb) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> '_comm_tr_orders'), '149 down · las demás funciones quedan idénticas');
  perform tests.ok((select n_s = (select count(*) from public.shipments) and n_o = (select count(*) from public.orders) from _pb) and to_regclass('public.shipment_tracking') is not null, '149 down · sin cambios de datos; la 148 sigue aplicada');
end $t$;
\ir ../../../migrations/20261202120000_paq_b_anular_guia.sql
do $t$ begin
  perform tests.ok((select todas from _pb) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '149 up tras down · el conjunto completo de funciones vuelve a ser idéntico');
end $t$;
rollback;
