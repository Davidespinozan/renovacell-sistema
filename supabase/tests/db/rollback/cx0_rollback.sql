-- CX-0A (135) · el down restaura EXACTAMENTE el precio_de/3 de producción (md5) sin barrera; /2 y permisos intactos;
-- sin cambios de datos.
begin;
create temp table _cx0 as select (select count(*) from public.product_prices) pp, (select count(*) from public.products) p;
\ir ../../../rollback/cx0/99_down.sql
do $t$
begin
  perform tests.eq(md5(pg_get_functiondef('public.precio_de(uuid,uuid,integer)'::regprocedure)), '9efe19506f40e19c3dc5baeca66b9014', '135 down · precio_de/3 idéntico al de producción (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.precio_de(uuid,uuid)'::regprocedure)), 'b256810a5e089355712bdeffcb423832', '135 down · precio_de/2 intacto');
  perform tests.ok(has_function_privilege('authenticated', 'public.precio_de(uuid,uuid,integer)', 'execute') and not has_function_privilege('anon', 'public.precio_de(uuid,uuid,integer)', 'execute'), '135 down · permisos como en producción');
  perform tests.ok((select pp = (select count(*) from public.product_prices) and p = (select count(*) from public.products) from _cx0), '135 down · sin cambios de datos');
end $t$;
rollback;
