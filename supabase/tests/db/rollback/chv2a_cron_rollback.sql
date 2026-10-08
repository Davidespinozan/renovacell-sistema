-- CHV2-A (124) · El rollback retira SOLO el job del evaluador; el de W6-A3 y el esquema de 123 quedan intactos.
begin;
set app.chatv2c1_rollback_forzado = 'on';   -- prueba estructural de la cadena completa (la frontera se prueba en chatv2c1_rollback.sql)
\ir ../../../rollback/cartera_p1/99_down.sql   -- CARTERA-P1 (131) se baja primero
\ir ../../../rollback/chatv2d1/99_down.sql   -- CHAT V2-D1 (130) se baja primero
\ir ../../../rollback/ci1/99_down.sql   -- Commercial Intent CI-1 (128) se baja primero
\ir ../../../rollback/chatv2c2/99_down.sql   -- Chat V2-C2 (127) se baja primero
\ir ../../../rollback/chatv2c1/99_down.sql   -- Chat V2-C1 (125) se baja primero
\ir ../../../rollback/chv2a_cron/99_down.sql
do $t$
begin
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-atencion-comercial'), 0, 'E · job del evaluador retirado');
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-alertas-diarias'), 1, 'E · renovacell-alertas-diarias intacto');
  perform tests.ok(to_regprocedure('public.cc_atencion_evaluar()') is not null and to_regclass('public.cc_atencion_config') is not null, 'E · el esquema de 123 no se toca');
end $t$;
rollback;
