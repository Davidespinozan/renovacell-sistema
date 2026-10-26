-- WHATSAPP DE IDA Y VUELTA (168) · el down regresa cc_wa_entrante a la 167 y retira la cola; se reaplica igual.
begin;
\ir lib/r4b2_bajar.sql   -- R4-B2 (B2-2, B2-3a, B2-1) se baja ANTES de la línea base de esta cadena
create temp table _ws as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/whatsapp_wamid_largo/99_down.sql   -- META-04 (188) redefine cc_wa_entrante/cc_meta_entrante: se baja primero
\ir ../../../rollback/meta_canales/99_down.sql   -- META-CANALES (170) se baja antes (usa cc_visitors/cc_messages y cambia _cc_nombre_dueno)
\ir ../../../rollback/whatsapp_bandeja/99_down.sql   -- WHATSAPP-BANDEJA (169) se baja antes que la 168
\ir ../../../rollback/whatsapp_salida/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_wa_salida') is null and not exists (select 1 from cron.job where jobname = 'renovacell-whatsapp') and to_regprocedure('public.cc_wa_entrante(text,text,text,text,boolean)') is not null, '168 down · sin cola ni tarea; la entrada de la 167 sigue');
end $t$;
\ir ../../../migrations/20261221120000_whatsapp_salida.sql
\ir ../../../migrations/20261222120000_whatsapp_bandeja.sql
\ir ../../../migrations/20261223120000_meta_canales.sql
\ir ../../../migrations/20270110120000_whatsapp_wamid_largo.sql
do $t$ begin
  perform tests.ok((select todas from _ws) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '168 · se reaplica idéntica');
end $t$;
\ir lib/r4b2_subir.sql   -- R4-B2 (B2-1, B2-3a, B2-2) se reaplica tras la comparación final
rollback;
