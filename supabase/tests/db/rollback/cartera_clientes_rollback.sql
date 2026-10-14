-- CARTERA-CLIENTES (152) · el down retira la cartera por cliente y devuelve las funciones exactamente a su versión
-- anterior; todo lo demás queda igual, y la migración se puede volver a aplicar.
begin;
create temp table _ck as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores', '_cc_prerregistro_coincidencia', '_cartera_cliente_al_ligar', 'cliente_vendedor_asignar', 'cliente_estado_guardar')) resto,
  (select count(*) from public.customers) n_c, (select count(*) from public.cc_cartera) n_k;
\ir ../../../rollback/cartera_clientes/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_cartera_clientes') is null and to_regclass('public.cc_cartera_clientes_historial') is null
    and not exists (select 1 from pg_proc where proname in ('cliente_vendedor_asignar', 'cliente_estado_guardar', '_cartera_cliente_al_ligar'))
    and not exists (select 1 from pg_trigger where tgname = 'trg_customers_cartera_al_ligar'), '152 down · sin tablas, comandos ni trigger');
  perform tests.ok(md5(pg_get_functiondef('public._c360_actor(uuid)'::regprocedure)) = '4952be3c8cc4c75ba0bc2fe0e914db70' and md5(pg_get_functiondef('public.cliente_360(uuid)'::regprocedure)) = '4d09fcfda9cbe2ac5cc261eb9871c53a'
    and md5(pg_get_functiondef('public.cc_mi_cartera()'::regprocedure)) = 'a02c498626e4454e236f4b6633502a41' and md5(pg_get_functiondef('public.cc_vendedores()'::regprocedure)) = 'cf9f22c438205f05d07ed450dd8ee009'
    and md5(pg_get_functiondef('public._cc_prerregistro_coincidencia(text,text)'::regprocedure)) = '0bcee140991db42178db2b6e6547371a', '152 down · funciones idénticas a producción');
  perform tests.ok((select resto from _ck) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores', '_cc_prerregistro_coincidencia')), '152 down · ninguna otra función cambió');
  perform tests.ok((select n_c = (select count(*) from public.customers) and n_k = (select count(*) from public.cc_cartera) from _ck), '152 down · sin cambios de datos');
end $t$;
\ir ../../../migrations/20261205120000_cartera_clientes.sql
do $t$ begin
  perform tests.ok((select todas from _ck) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '152 · se vuelve a aplicar y queda idéntica');
end $t$;
rollback;
