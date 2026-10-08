-- CARTERA-P1 (131) · el down retira las RPC y las tablas de equivalencias; no toca cc_cartera ni customers.
begin;
create temp table _cp1_antes as select (select count(*) from public.cc_cartera) k, (select count(*) from public.customers) c;
\ir ../../../rollback/cartera_p1/99_down.sql
do $t$
begin
  perform tests.ok(to_regprocedure('public.cc_mi_cartera()') is null and to_regprocedure('public.cc_mi_cartera_historica()') is null
                   and to_regprocedure('public.cc_equivalencia_historica_guardar(text,uuid,text)') is null and to_regprocedure('public._cc_vendedor_consulta()') is null, '131 down · RPC retiradas');
  perform tests.ok(to_regclass('public.cc_cartera_historica_equivalencias') is null and to_regclass('public.cc_cartera_historica_eventos') is null, '131 down · tablas retiradas');
  perform tests.ok(to_regclass('public.cc_cartera') is not null and to_regprocedure('public.cc_cartera_asignar(uuid,uuid,text)') is not null, '131 down · CC-7 intacto');
  perform tests.ok((select k = (select count(*) from public.cc_cartera) and c = (select count(*) from public.customers) from _cp1_antes), '131 down · sin cambios de datos');
end $t$;
rollback;
