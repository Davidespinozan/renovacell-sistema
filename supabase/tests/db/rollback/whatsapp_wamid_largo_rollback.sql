-- META-04 (188) · el down devuelve cc_wa_entrante a la 168 y cc_meta_entrante a la 170 y retira el derivado; se reaplica idéntica.
begin;
\ir ../../../rollback/canal_prueba_contacto/99_down.sql   -- R4-C5 (0123) se baja ANTES de la línea base de esta cadena
create temp table _wl as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
\ir ../../../rollback/whatsapp_wamid_largo/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._cc_client_id_canal(text,text)') is null, '188 down · sin derivado');
  perform tests.ok(position('_cc_client_id_canal' in pg_get_functiondef('public.cc_wa_entrante(text,text,text,text,boolean)'::regprocedure)) = 0 and position($$'wa:' || p_wamid$$ in pg_get_functiondef('public.cc_wa_entrante(text,text,text,text,boolean)'::regprocedure)) > 0, '188 down · cc_wa_entrante como en la 168');
  perform tests.ok(position($$'meta:' || p_mid$$ in pg_get_functiondef('public.cc_meta_entrante(text,text,text,text,text,boolean)'::regprocedure)) > 0, '188 down · cc_meta_entrante como en la 170');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select n_tablas from _wl), '188 down · mismas tablas');
end $t$;
\ir ../../../migrations/20270110120000_whatsapp_wamid_largo.sql
do $t$ begin
  perform tests.ok((select todas from _wl) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '188 · se reaplica idéntica');
end $t$;
\ir ../../../migrations/20270123120000_canal_prueba_contacto.sql   -- R4-C5 (0123) se reaplica tras la comparación final
rollback;
