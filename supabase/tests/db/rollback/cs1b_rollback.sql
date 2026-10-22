-- CS-1A.1b (185) · el down retira solo la guarda; CS-1A.1a sigue íntegro; bajar ambos respeta el ledger; se reaplican idénticas.
begin;
create temp table _cs1b as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') as n_tablas,
  (select md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure))
   || md5(pg_get_functiondef('public.revisar_pago(uuid,uuid,text,numeric,date,text)'::regprocedure))
   || md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure))) as comandos;
\ir ../../../rollback/cs1a7_cierre_manual/99_down.sql   -- CS-1A.7 (187) redefine cs_intento_avanzar y añade cs_intento_cerrar_manual: se baja primero
\ir ../../../rollback/cs1a6_reversa/99_down.sql   -- CS-1A.6 (186) redefine _cs_transicion_valida: se baja primero y se reaplica al final
-- 1) bajar solo 1b: 1a intacto
\ir ../../../rollback/cs1b_reserva_guard/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from pg_trigger where tgname = 'trg_cs_reserva_guard') and to_regprocedure('public._cs_reserva_guard()') is null, '185 down · sin guarda');
  perform tests.ok(to_regclass('public.card_payment_attempts') is not null and to_regprocedure('public.cs_intento_abrir(uuid,text)') is not null and to_regclass('public.v_order_disponible') is not null, '185 down · CS-1A.1a intacto');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select n_tablas from _cs1b), '185 down · mismas tablas');
end $t$;
-- 2) bajar también 1a: el ledger queda como antes de 184
\ir ../../../rollback/cs1a_intentos/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.card_payment_attempts') is null and to_regclass('public.payment_entries') is not null and to_regclass('public.v_order_money') is not null, '184+185 down · ledger intacto');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') + 2, (select n_tablas from _cs1b), '184+185 down · 2 tablas menos');
end $t$;
-- 3) reaplicar ambas: idénticas
\ir ../../../migrations/20270106120000_cs1a_intentos_tarjeta.sql
\ir ../../../migrations/20270107120000_cs1b_reserva_guard.sql
\ir ../../../migrations/20270108120000_cs1a6_reversa_autorizacion.sql
\ir ../../../migrations/20270109120000_cs1a7_cierre_manual.sql
do $t$ begin
  perform tests.ok((select todas from _cs1b) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '184+185 · se reaplican idénticas (todas las funciones)');
  perform tests.eq((select comandos from _cs1b), md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure))
   || md5(pg_get_functiondef('public.revisar_pago(uuid,uuid,text,numeric,date,text)'::regprocedure))
   || md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)), '184+185 · registrar_cobro / revisar_pago / vender_pos sin cambios');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'trg_cs_reserva_guard'), '185 · guarda de vuelta');
end $t$;
rollback;
