-- MAYOREO-REGLAS (20270222) · el down devuelve el precio renglón por renglón exacto y retira el cálculo del pedido y el nivel;
-- se reaplica idéntica.
begin;
create temp table _mr as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/mayoreo_reglas/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._qty_volumen(jsonb)') is null and to_regprocedure('public.precio_de(uuid,uuid,integer,integer)') is null
               and not exists (select 1 from information_schema.columns where table_name = 'product_volume_prices' and column_name = 'nivel')
               and md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = 'bee5aa3614e2b9e0327ebec6a1b38e2e'
               and md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) = '643cda22dcd76283ae8225ebb6afd188',
    'MAYOREO-REGLAS down · crear_pedido y vender_pos exactos de antes; sin cálculo del pedido ni nivel');
end $t$;
\ir ../../../migrations/20270222120000_mayoreo_reglas.sql
do $t$ begin
  perform tests.ok((select todas from _mr) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'MAYOREO-REGLAS · se reaplica idéntica');
end $t$;
rollback;
