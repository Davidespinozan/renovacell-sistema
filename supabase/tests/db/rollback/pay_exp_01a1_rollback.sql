-- PAY-EXP-01A-1 (133) · el down restaura EXACTAMENTE el revisar_pago de W2 (mismo md5 que producción antes de la
-- 133) y retira el índice único; sin cambios de datos.
begin;
create temp table _p1a1 as select (select count(*) from public.payment_entries) e, (select count(*) from public.payment_claims) c;
\ir ../../../rollback/pay_exp_01a1/99_down.sql
do $t$
begin
  perform tests.eq(md5(pg_get_functiondef('public.revisar_pago(uuid,uuid,text,numeric,date,text)'::regprocedure)), '1233229f0c80d147a17f2c2b5e14b2d7', '133 down · revisar_pago idéntico al de producción (md5)');
  perform tests.ok(to_regclass('public.uq_entry_claim_original') is null, '133 down · índice retirado');
  perform tests.ok(has_function_privilege('authenticated', 'public.revisar_pago(uuid,uuid,text,numeric,date,text)', 'execute'), '133 down · permisos intactos');
  perform tests.ok((select e = (select count(*) from public.payment_entries) and c = (select count(*) from public.payment_claims) from _p1a1), '133 down · sin cambios de datos');
end $t$;
rollback;
