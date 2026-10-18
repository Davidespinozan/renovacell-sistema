-- PROMOCIONES (173) · el down retira las promociones y precio_de/3 vuelve al texto de la 135; se reaplica igual; con
-- promociones capturadas se niega salvo bandera.
begin;
create temp table _pr as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
set app.promociones_rollback_forzado = 'on';
\ir ../../../rollback/promocion_prueba_correo/99_down.sql   -- PROMO-PRUEBA (178) se baja primero
\ir ../../../rollback/promociones_marketing/99_down.sql   -- PROMO-MARKETING (177) se baja primero
\ir ../../../rollback/promocion_eliminar/99_down.sql   -- PROMO-ELIMINAR (176) se baja primero
\ir ../../../rollback/promociones_difusion/99_down.sql   -- PROMO-DIFUSION (175) se baja primero
\ir ../../../rollback/promociones_pro/99_down.sql   -- PROMO-PRO (174) se baja primero
\ir ../../../rollback/promociones/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.promociones') is null and to_regprocedure('public.promos_vigentes()') is null
               and md5(pg_get_functiondef('public.precio_de(uuid,uuid,integer)'::regprocedure)) = '349176d8415cc46db01f1eaf887c9255'
               and (select n_tablas from _pr) = (select count(*) + 3 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), '173 down · sin promociones; precio_de/3 como en la 135');
end $t$;
\ir ../../../migrations/20261226120000_promociones.sql
\ir ../../../migrations/20261227120000_promociones_pro.sql
\ir ../../../migrations/20261228120000_promociones_difusion.sql
\ir ../../../migrations/20261229120000_promocion_eliminar.sql
\ir ../../../migrations/20261230120000_promociones_marketing.sql
\ir ../../../migrations/20261231120000_promocion_prueba_correo.sql
do $t$ begin
  perform tests.ok((select todas from _pr) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '173 · se reaplica idéntica');
end $t$;
savepoint con_datos;
do $t$ declare v_admin uuid := tests.fixture_admin(); p uuid := tests.product(100); begin
  perform tests.act_as(v_admin);
  perform public.promocion_guardar(jsonb_build_object('nombre', 'Rb', 'desde', current_date, 'hasta', current_date, 'lineas', jsonb_build_array(jsonb_build_object('product_id', p, 'precio', 50))));
  perform tests.act_as_owner();
end $t$;
set app.promociones_rollback_forzado = 'off';
do $t$ begin
  begin
    execute $d$ do $pre$ begin if coalesce(current_setting('app.promociones_rollback_forzado', true), '') <> 'on' and exists (select 1 from public.promociones) then raise exception 'PROMOCIONES down: hay promociones capturadas'; end if; end $pre$ $d$;
    perform tests.ok(false, '173 down · con promociones debe negarse');
  exception when others then
    perform tests.ok(sqlerrm like 'PROMOCIONES down: hay promociones%', '173 down · con promociones capturadas se niega (la guarda del down)');
  end;
end $t$;
rollback to savepoint con_datos;
rollback;
