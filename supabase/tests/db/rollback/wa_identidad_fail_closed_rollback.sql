-- R4-B1 · el down devuelve _cc_wa_perfil EXACTAMENTE a la 167 (recurso documentado: reintroduce la vulnerabilidad) sin tocar
-- datos; se reaplica idéntica.
begin;
create temp table _r4 as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from public.cc_wa_contactos) n_contactos, (select count(*) from public.cc_messages) n_mensajes;
\ir ../../../rollback/wa_identidad_fail_closed/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public._cc_wa_perfil(text)'::regprocedure)) = '12f258498b4287011bcda22829c9f07d', 'R4-B1 down · _cc_wa_perfil idéntica a la 167');
  perform tests.ok(not has_function_privilege('authenticated', 'public._cc_wa_perfil(text)', 'execute'), 'R4-B1 down · sigue sin ejecutarse por clientes');
  perform tests.ok((select n_contactos = (select count(*) from public.cc_wa_contactos) and n_mensajes = (select count(*) from public.cc_messages) from _r4), 'R4-B1 down · sin cambios de datos');
end $t$;
\ir ../../../migrations/20270117120000_wa_identidad_fail_closed.sql
do $t$ begin
  perform tests.ok((select todas from _r4) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'R4-B1 · se reaplica idéntica');
end $t$;
rollback;
