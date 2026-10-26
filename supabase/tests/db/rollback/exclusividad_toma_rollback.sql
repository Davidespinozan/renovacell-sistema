-- R4-B2-3b · el down retira exclusividad, filtro de IA en la salida y toma de Dirección sin tocar conversaciones ni mensajes;
-- se reaplica idéntica.
begin;
create temp table _ex as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from public.cc_messages) n_msgs, (select count(*) from public.cc_conversations) n_convs;
\ir ../../../rollback/exclusividad_toma/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_tomar_conversacion(uuid,text)') is null and not exists (select 1 from pg_trigger where tgname in ('trg_ccm_exclusividad_canal', 'trg_ccc_toma_limpiar', 'trg_cc_wa_salida_filtrar_ia', 'trg_cc_meta_salida_filtrar_ia')), 'B2-3b down · sin toma ni triggers');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'cc_conversations' and column_name in ('tomada_por', 'tomada_at')), 'B2-3b down · sin columnas de toma');
  perform tests.ok((select n_msgs = (select count(*) from public.cc_messages) and n_convs = (select count(*) from public.cc_conversations) from _ex), 'B2-3b down · conversaciones y mensajes intactos');
  perform tests.ok(to_regclass('public.cc_salida_decisiones') is not null and to_regprocedure('public._cc_ia_permitida_en(uuid,boolean)') is not null, 'B2-3b down · B2-1/B2-3a/B2-2 intactos');
end $t$;
\ir ../../../migrations/20270121120000_exclusividad_toma.sql
do $t$ begin
  perform tests.ok((select todas from _ex) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'B2-3b · se reaplica idéntica');
end $t$;
rollback;
