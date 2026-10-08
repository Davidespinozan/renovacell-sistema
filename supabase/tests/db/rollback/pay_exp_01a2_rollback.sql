-- PAY-EXP-01A-2 (134) · el down retira la lectura; no toca datos ni otras funciones de dinero.
begin;
create temp table _p1a2 as select (select count(*) from public.payment_entries) e, (select count(*) from public.payment_claims) c,
  md5(pg_get_functiondef('public.revisar_pago(uuid,uuid,text,numeric,date,text)'::regprocedure)) rv;
\ir ../../../rollback/pay_exp_01a2/99_down.sql
do $t$
begin
  perform tests.ok(to_regprocedure('public.revision_economica(boolean)') is null, '134 down · lectura retirada');
  perform tests.ok(to_regprocedure('public.conciliar_dinero()') is not null and to_regclass('public.v_order_money') is not null, '134 down · conciliación y v_order_money intactas');
  perform tests.ok((select e = (select count(*) from public.payment_entries) and c = (select count(*) from public.payment_claims)
                    and rv = md5(pg_get_functiondef('public.revisar_pago(uuid,uuid,text,numeric,date,text)'::regprocedure)) from _p1a2), '134 down · sin cambios de datos ni de revisar_pago (01A-1)');
end $t$;
rollback;
