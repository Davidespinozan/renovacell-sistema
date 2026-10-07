-- CHV2-A (124) · El rollback retira SOLO el job del evaluador; el de W6-A3 y el esquema de 123 quedan intactos.
begin;
\ir ../../../rollback/chv2a_cron/99_down.sql
do $t$
begin
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-atencion-comercial'), 0, 'E · job del evaluador retirado');
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-alertas-diarias'), 1, 'E · renovacell-alertas-diarias intacto');
  perform tests.ok(to_regprocedure('public.cc_atencion_evaluar()') is not null and to_regclass('public.cc_atencion_config') is not null, 'E · el esquema de 123 no se toca');
end $t$;
rollback;
