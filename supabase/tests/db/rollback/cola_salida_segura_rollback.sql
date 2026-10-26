-- R4-B2-2 · el down devuelve la cola EXACTAMENTE a producción (26 oct 2026) y retira estados nuevos, evidencia, decisiones,
-- verificación previa y RPC; se reaplica idéntica. (La negativa con retenidos se prueba en precondition/r4b22_down_precondicion.sh.)
begin;
update public.cc_wa_salida set estado = 'fallido' where estado in ('retenido', 'incierto', 'descartado');   -- (datos de otras pruebas)
update public.cc_meta_salida set estado = 'fallido' where estado in ('retenido', 'incierto', 'descartado');
create temp table _cs as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas, (select count(*) from public.cc_wa_salida) n_wa, (select count(*) from public.cc_meta_salida) n_meta;
\ir ../../../rollback/cola_salida_segura/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_salida_decisiones') is null and to_regprocedure('public.cc_salida_decidir(text,uuid[],text,text)') is null
    and to_regprocedure('public.cc_wa_salida_puede_enviar(uuid)') is null, 'B2-2 down · sin decisiones, RPC ni verificación previa');
  perform tests.ok(md5(pg_get_functiondef('public.cc_wa_salida_reclamar(integer)'::regprocedure)) = '028f05722b9265233963494ef6f75d9c'
    and md5(pg_get_functiondef('public._cc_meta_encolar()'::regprocedure)) = '24d3218f716f88c73629cad1db0dbced', 'B2-2 down · cola idéntica a producción');
  perform tests.ok((select n_wa = (select count(*) from public.cc_wa_salida) and n_meta = (select count(*) from public.cc_meta_salida) from _cs)
    and not exists (select 1 from information_schema.columns where table_name = 'cc_wa_salida' and column_name in ('retenido_at', 'resultado')), 'B2-2 down · mensajes intactos y sin columnas nuevas');
  perform tests.ok(to_regprocedure('public._cc_ia_permitida_en(uuid,boolean)') is not null and to_regclass('public.cc_canal_control_hist') is not null, 'B2-2 down · B2-1 y B2-3a intactos');
end $t$;
\ir ../../../migrations/20270120120000_cola_salida_segura.sql
do $t$ begin
  perform tests.ok((select todas from _cs) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'B2-2 · se reaplica idéntica');
end $t$;
rollback;
