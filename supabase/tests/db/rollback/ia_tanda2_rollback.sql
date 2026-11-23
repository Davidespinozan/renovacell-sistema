-- IA · TANDA 2 (20270407480000) · el down regresa la búsqueda y el aviso de verificación de antes y retira lo nuevo; se reaplica idéntica.
begin;
create temp table _t2 as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/ia_tanda2/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_ia_producto_estado(text,text)') is null and to_regprocedure('public._cc_ia_q(text)') is null and to_regclass('public.cc_busqueda_sinonimos') is null
               and pg_get_functiondef('public.cc_buscar_productos(text,integer,text)'::regprocedure) not like '%parecido%'
               and pg_get_functiondef('public.cc_alta_wa_cerrar(uuid,uuid,uuid,uuid,text,boolean)'::regprocedure) like '%verificado(a)%'
               and not exists (select 1 from public.cc_ia_examen_casos where id = 'CV13'), 'IA-TANDA2 down · como antes');
end $t$;
\ir ../../../migrations/20270407480000_ia_tanda2.sql
do $t$ begin
  perform tests.ok((select todas from _t2) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'IA-TANDA2 · se reaplica idéntica');
end $t$;
rollback;
