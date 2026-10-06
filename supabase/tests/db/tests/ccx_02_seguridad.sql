-- PREFLIGHT CC · RECHECK DE AUTORIDAD TRANSVERSAL con todas las migraciones apiladas.
begin;
do $t$
declare n int; lst text;
begin
  select count(*), string_agg(table_name || ':' || privilege_type, ',') into n, lst from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and not (privilege_type = 'SELECT' and table_name in ('landing_content', 'catalog_public'));
  perform tests.eq(n, 0, 'anon sin grants fuera de landing_content/catalog_public SELECT (' || coalesce(lst, '') || ')');
  select count(*), string_agg(table_name || ':' || privilege_type, ',') into n, lst from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and table_name like 'cc\_%' and privilege_type <> 'SELECT';
  perform tests.eq(n, 0, 'authenticated sin escritura en cc_* (' || coalesce(lst, '') || ')');
  select count(*), string_agg(g.table_name, ',') into n, lst from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee = 'authenticated' and g.table_name like 'cc\_%' and g.privilege_type = 'SELECT'
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = g.table_name and 'authenticated' = any (p.roles) and p.cmd in ('SELECT', 'ALL'));
  perform tests.eq(n, 0, 'cada SELECT de authenticated en cc_* tiene política RLS (' || coalesce(lst, '') || ')');
  select count(*), string_agg(c.relname, ',') into n, lst from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and (c.relname like 'cc\_%' or c.relname like 'rate\_limit%') and not c.relrowsecurity;
  perform tests.eq(n, 0, 'RLS encendida en todas las tablas cc_*/rate_limit (' || coalesce(lst, '') || ')');
  select count(*), string_agg(g.table_name || ':' || g.privilege_type, ',') into n, lst from information_schema.role_table_grants g join pg_views v on v.viewname = g.table_name and v.schemaname = 'public' where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated') and g.privilege_type <> 'SELECT';
  perform tests.eq(n, 0, 'vistas sin escritura para clientes (' || coalesce(lst, '') || ')');
  select count(*), string_agg(p.proname, ',') into n, lst from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and (p.proname like 'cc\_%' or p.proname like '\_cc\_%' or p.proname in ('crear_pedido', 'siguiente_folio')) and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform tests.eq(n, 0, 'security definer con search_path fijo (' || coalesce(lst, '') || ')');
  select count(*), string_agg(p.proname, ',') into n, lst from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and (p.proname like 'cc\_%' or p.proname like '\_cc\_%') and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname not in ('cc_ficha_producto', 'cc_buscar_productos', 'cc_buscar_conocimiento', 'cc_comparar_productos', 'cc_candidatos_recomendacion', 'cc_catalogo_para_ia', 'cc_audiencia_actual', 'cc_revisar_claims');
  perform tests.eq(n, 0, 'anon solo ejecuta lecturas públicas de conocimiento (' || coalesce(lst, '') || ')');
  select count(*), string_agg(p.proname, ',') into n, lst from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname ~ '^cc_(visitante|abrir_conversacion|enviar_mensaje|ia_|carrito_|codigo)' and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.proname not in ('cc_codigo_referido_crear', 'cc_codigo_referido_revocar');
  perform tests.eq(n, 0, 'comandos de servidor (visitante/conversación/IA/carrito) no ejecutables por authenticated (' || coalesce(lst, '') || ')');
  perform tests.ok(has_function_privilege('authenticated', 'public.cc_checkout_confirmar(uuid,text,int,boolean,uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.cc_checkout_confirmar(uuid,text,int,boolean,uuid)', 'EXECUTE'), 'checkout: authenticated sí (deriva auth.uid), anon no');
  perform tests.ok(not exists (select 1 from pg_default_acl d join pg_roles r on r.oid = d.defaclrole join pg_namespace s on s.oid = d.defaclnamespace where r.rolname = 'postgres' and s.nspname = 'public' and array_to_string(d.defaclacl, ',') like '%anon=%'), 'D-CC0B: sin default privileges para anon en public');
  perform tests.ok(not has_table_privilege('authenticated', 'public.cc_product_knowledge', 'SELECT') and not has_table_privilege('anon', 'public.cc_product_knowledge', 'SELECT'), 'borradores de conocimiento sin lectura directa');
end $t$;
rollback;
