-- CS-1A.7 (187) · el down retira la RPC de cierre manual y devuelve cs_intento_avanzar a la 184; se reaplica idéntica.
begin;
create temp table _cs17 as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') as n_tablas,
  (select md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)) || md5(pg_get_functiondef('public._cs_transicion_valida(text,text)'::regprocedure)) || md5(pg_get_functiondef('public._cs_reserva_guard()'::regprocedure))) as intactas;
\ir ../../../rollback/cs1a7_cierre_manual/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cs_intento_cerrar_manual(uuid,text,jsonb)') is null, '187 down · sin RPC de cierre manual');
  perform tests.ok(position('CIERRE_MANUAL_REQUERIDO' in pg_get_functiondef('public.cs_intento_avanzar(uuid,text,jsonb)'::regprocedure)) = 0
               and position('PROVEEDOR_REQUERIDO' in pg_get_functiondef('public.cs_intento_avanzar(uuid,text,jsonb)'::regprocedure)) = 0, '187 down · cs_intento_avanzar sin las guardas nuevas (definición de la 184)');
  perform tests.ok(to_regclass('public.card_payment_attempts') is not null and to_regprocedure('public.cs_intento_contabilizar(uuid)') is not null and exists (select 1 from pg_trigger where tgname = 'trg_cs_reserva_guard'), '187 down · 184/185/186 intactas');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select n_tablas from _cs17), '187 down · mismas tablas');
  perform tests.eq((select intactas from _cs17), md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)) || md5(pg_get_functiondef('public._cs_transicion_valida(text,text)'::regprocedure)) || md5(pg_get_functiondef('public._cs_reserva_guard()'::regprocedure)), '187 down · registrar_cobro / máquina de estados / guarda sin cambios');
end $t$;
\ir ../../../migrations/20270109120000_cs1a7_cierre_manual.sql
do $t$ begin
  perform tests.ok((select todas from _cs17) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '187 · se reaplica idéntica (todas las funciones)');
  perform tests.ok(to_regprocedure('public.cs_intento_cerrar_manual(uuid,text,jsonb)') is not null, '187 · RPC de vuelta');
end $t$;
rollback;
