-- CC-3 · El rollback retira el dominio de conocimiento sin tocar products ni CC-1/CC-2.
begin;
\ir ../../../rollback/cc3/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_product_knowledge') is null and to_regclass('public.cc_knowledge_sources') is null and to_regclass('public.cc_company_knowledge') is null
               and to_regclass('public.cc_product_aliases') is null and to_regclass('public.cc_product_relations') is null and to_regclass('public.cc_claim_rules') is null
               and to_regclass('public.cc_knowledge_config') is null and to_regclass('public.cc_knowledge_events') is null, 'tablas de conocimiento retiradas');
  perform tests.ok(to_regprocedure('public.cc_ficha_producto(uuid,text)') is null and to_regprocedure('public.cc_buscar_productos(text,int,text)') is null
               and to_regprocedure('public.cc_conocimiento_aprobar(uuid,boolean)') is null and to_regprocedure('public._cc_nivel_seccion(text)') is null, 'funciones CC-3 retiradas');
  perform tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'cc\_%conocimiento%' or p.proname like '%knowledge%')), 'sin residuos de funciones');
  perform tests.ok(to_regclass('public.products') is not null and exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'odoo_reference'), 'products intacto');
  perform tests.ok(to_regclass('public.cc_visitors') is not null and to_regclass('public.cc_conversations') is not null and to_regprocedure('public._cc_append_only()') is not null, 'CC-1 y CC-2 intactos tras bajar CC-3');
  perform tests.ok(to_regprocedure('public.auth_role()') is not null and to_regprocedure('public.puede_ver_precio()') is not null, 'W6-A1 y CC-0A intactos');
end $t$;
rollback;
