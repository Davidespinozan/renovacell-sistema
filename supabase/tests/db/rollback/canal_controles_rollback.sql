-- R4-B2-1 · el down retira columnas, historial, triggers, compuerta y RPC sin tocar los modos; se reaplica idéntica.
begin;
create temp table _cc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select modo from public.cc_wa_config) wa_modo, (select string_agg(canal || ':' || modo, ',' order by canal) from public.cc_meta_config) meta_modos;
\ir ../../../rollback/canal_controles/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_canal_control_hist') is null and to_regprocedure('public.cc_canal_cambiar(text,jsonb,text)') is null
    and to_regprocedure('public.cc_canal_estado()') is null and to_regprocedure('public._cc_canal_activacion_lista()') is null, 'B2-1 down · sin historial, RPC ni compuerta');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name in ('cc_wa_config', 'cc_meta_config') and column_name in ('ia_habilitada', 'envio_pausado')), 'B2-1 down · sin columnas nuevas');
  perform tests.ok((select wa_modo = (select modo from public.cc_wa_config) and meta_modos = (select string_agg(canal || ':' || modo, ',' order by canal) from public.cc_meta_config) from _cc), 'B2-1 down · modos intactos');
end $t$;
\ir ../../../migrations/20270118120000_canal_controles.sql
do $t$ begin
  perform tests.ok((select todas from _cc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'B2-1 · se reaplica idéntica');
end $t$;
rollback;
