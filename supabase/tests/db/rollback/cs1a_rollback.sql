-- CS-1A.1a (184) · el down retira tablas, vista, RPC y tarea; el ledger y registrar_cobro no cambian; se reaplica idéntica.
begin;
create temp table _cs1 as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') as n_tablas,
  (select md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure))) as cobro;
\ir ../../../rollback/cs1a7_cierre_manual/99_down.sql   -- CS-1A.7 (187) redefine cs_intento_avanzar y añade cs_intento_cerrar_manual: se baja primero
\ir ../../../rollback/cs1a6_reversa/99_down.sql   -- CS-1A.6 (186) redefine _cs_transicion_valida: se baja primero y se reaplica al final
\ir ../../../rollback/cs1a_intentos/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.card_payment_attempts') is null and to_regclass('public.card_payment_attempt_events') is null and to_regclass('public.v_order_disponible') is null
               and to_regprocedure('public.cs_intento_abrir(uuid,text)') is null and to_regprocedure('public.saldo_disponible(uuid)') is null
               and not exists (select 1 from cron.job where jobname = 'renovacell-cs-intentos'), '184 down · sin tablas, vista, RPC ni tarea');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') + 2, (select n_tablas from _cs1), '184 down · exactamente 2 tablas menos');
  perform tests.eq(md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)), (select cobro from _cs1), '184 down · registrar_cobro intacto');
  perform tests.ok(to_regclass('public.payment_entries') is not null and to_regclass('public.v_order_money') is not null, '184 down · ledger intacto');
end $t$;
\ir ../../../migrations/20270106120000_cs1a_intentos_tarjeta.sql
\ir ../../../migrations/20270108120000_cs1a6_reversa_autorizacion.sql
\ir ../../../migrations/20270109120000_cs1a7_cierre_manual.sql
do $t$ begin
  perform tests.ok((select todas from _cs1) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '184 · se reaplica idéntica (todas las funciones)');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select n_tablas from _cs1), '184 · mismas tablas tras reaplicar');
end $t$;
rollback;
