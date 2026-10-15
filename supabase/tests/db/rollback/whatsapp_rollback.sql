-- WHATSAPP EN EL CHAT (167) · el down regresa _cc_nombre_dueno a la 150 y retira lo nuevo; se reaplica igual.
begin;
create temp table _wa as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/meta_canales/99_down.sql   -- META-CANALES (170) se baja antes (usa cc_visitors/cc_messages y cambia _cc_nombre_dueno)
\ir ../../../rollback/whatsapp_bandeja/99_down.sql   -- WHATSAPP-BANDEJA (169) se baja antes que la 168
\ir ../../../rollback/whatsapp_salida/99_down.sql   -- WHATSAPP-SALIDA (168) se baja antes que la 167
\ir ../../../rollback/whatsapp_canal/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) = '1ebaa87f1e9a1072df6d1eb16b3a0c92' and to_regclass('public.cc_wa_contactos') is null, '167 down · nombre como en la 150, sin tablas de WhatsApp');
end $t$;
\ir ../../../migrations/20261220120000_whatsapp_canal.sql
\ir ../../../migrations/20261221120000_whatsapp_salida.sql
\ir ../../../migrations/20261222120000_whatsapp_bandeja.sql
\ir ../../../migrations/20261223120000_meta_canales.sql
do $t$ begin
  perform tests.ok((select todas from _wa) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '167 · se reaplica idéntica');
end $t$;
rollback;
