-- WHATSAPP · BANDEJA (169) · el down retira solo cc_wa_bandeja; se reaplica igual.
begin;
\ir lib/r4b2_bajar.sql   -- R4-B2 (B2-2, B2-3a, B2-1) se baja ANTES de la línea base de esta cadena
create temp table _wb as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) n;
\ir ../../../rollback/whatsapp_wamid_largo/99_down.sql   -- META-04 (188) redefine cc_wa_entrante/cc_meta_entrante: se baja primero
\ir ../../../rollback/meta_canales/99_down.sql   -- META-CANALES (170) se baja antes (usa cc_visitors/cc_messages y cambia _cc_nombre_dueno)
\ir ../../../rollback/whatsapp_bandeja/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_wa_bandeja()') is null and (select n from _wb) = (select count(*) + 11 from pg_proc where pronamespace = 'public'::regnamespace)   -- 10 de la 169/170 + _cc_client_id_canal (188)
               and to_regclass('public.cc_wa_config') is not null and to_regprocedure('public.cc_wa_entrante(text,text,text,text,boolean)') is not null, '169 down (tras bajar la 170) · desaparecen la bandeja y lo de Meta; la 167 y la 168 siguen');
end $t$;
\ir ../../../migrations/20261222120000_whatsapp_bandeja.sql
\ir ../../../migrations/20261223120000_meta_canales.sql
\ir ../../../migrations/20270110120000_whatsapp_wamid_largo.sql
do $t$ begin
  perform tests.ok((select todas from _wb) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '169 · se reaplica idéntica');
end $t$;
\ir lib/r4b2_subir.sql   -- R4-B2 (B2-1, B2-3a, B2-2) se reaplica tras la comparación final
rollback;
