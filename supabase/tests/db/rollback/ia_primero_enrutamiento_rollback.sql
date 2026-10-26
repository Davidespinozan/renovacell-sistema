-- R4-B2-3a · el down devuelve las 5 funciones EXACTAMENTE a producción (26 oct 2026) y retira los ayudantes; se reaplica idéntica.
begin;
\ir ../../../rollback/canal_prueba_contacto/99_down.sql   -- R4-C5 (0123) se baja ANTES de la línea base de esta cadena
create temp table _ip as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
\ir ../../../rollback/ia_primero_enrutamiento/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._cc_ia_permitida_en(uuid,boolean)') is null and to_regprocedure('public._cc_canal_transferir(uuid,text,text,text,boolean)') is null
    and to_regprocedure('public._cc_canal_de(uuid)') is null, 'B2-3a down · sin ayudantes');
  perform tests.ok(md5(pg_get_functiondef('public.cc_ia_turno_reclamar(uuid,bigint,text,text,integer)'::regprocedure)) = '4a3ddb5cffe2045f544d719fb957b483'
    and md5(pg_get_functiondef('public._cc_wa_a_cola(uuid)'::regprocedure)) = '1b4ae20c689e0e217f033ecffc4da68c', 'B2-3a down · funciones idénticas a producción');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select n_tablas from _ip), 'B2-3a down · mismas tablas');
  perform tests.ok(to_regclass('public.cc_canal_control_hist') is not null, 'B2-3a down · R4-B2-1 intacto');
end $t$;
\ir ../../../migrations/20270119120000_ia_primero_enrutamiento.sql
do $t$ begin
  perform tests.ok((select todas from _ip) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'B2-3a · se reaplica idéntica');
end $t$;
\ir ../../../migrations/20270123120000_canal_prueba_contacto.sql   -- R4-C5 (0123) se reaplica tras la comparación final
rollback;
