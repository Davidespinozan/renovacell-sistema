-- SEC-C2 (141) · el down quita security_invoker de las dos vistas y las deja EXACTAMENTE como en producción antes de la 141
-- (sin opciones, misma definición, columnas, dueño y permisos); políticas y datos intactos. Revertir REABRE la exposición.
begin;
create temp table _secc2 as select (select count(*) from public.custodies) c, (select count(*) from public.custody_lines) l;
\ir ../../../rollback/sec_c2/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_ajeno uuid := tests.user('doctor'); p uuid := tests.product(100); lot uuid; cus uuid; n int;
begin
  perform tests.ok((select bool_and(reloptions is null and relowner = 'postgres'::regrole and relkind = 'v') from pg_class
                    where oid in ('public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass)), '141 down · vistas sin opciones (como producción), dueño postgres');
  perform tests.ok(md5(pg_get_viewdef('public.v_custody_stock'::regclass)) = '894b9ed23d36bba674c20c4d0d818551'
               and md5(pg_get_viewdef('public.v_custody_liquidacion'::regclass)) = '794c370463acb6d8080883743e587a20', '141 down · definiciones idénticas a producción (md5)');
  perform tests.ok((select bool_and(has_table_privilege('authenticated', oid, 'SELECT') and has_table_privilege('service_role', oid, 'SELECT') and not has_table_privilege('anon', oid, 'SELECT'))
                    from pg_class where oid in ('public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass)), '141 down · permisos como en producción');
  perform tests.ok((select md5(qual) from pg_policies where tablename = 'custodies' and policyname = 'custodies_select_ops') = '75bc0009832a1daac1a00b2de519f1b5'
               and (select md5(qual) from pg_policies where tablename = 'custody_lines' and policyname = 'custody_lines_select_ops') = '986084c8d75a2ed1788d8a28a6204dee', '141 down · políticas intactas');
  perform tests.ok((select c = (select count(*) from public.custodies) and l = (select count(*) from public.custody_lines) from _secc2), '141 down · sin cambios de datos');
  -- el down reabre la exposición (documentado): un doctor sin relación vuelve a leer la custodia de un POS
  perform tests.act_as_owner();
  lot := tests.stock(p, 'C2-RB', 10); cus := tests.custodia('vendedor', v_pos); perform tests.entregar(cus, lot, 3);
  perform tests.act_as(v_ajeno);
  select count(*) into n from public.v_custody_stock where custody_id = cus;
  perform tests.act_as_owner();
  perform tests.ok(n = 1, '141 down · REABRE la exposición: un usuario sin relación vuelve a leer custodias ajenas (por eso no se revierte sin decisión)');
end $t$;
rollback;
