-- CC-0B · Higiene de privilegios: ninguna vista admite escritura; anon solo lee el
-- catálogo público y el contenido de la landing; authenticated escribe únicamente donde
-- una política lo contempla; lo legítimo (RPC, realtime, lecturas) sigue funcionando.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  v_p uuid := tests.product(100); r record; n int; v_antes text;
begin
  -- ══ N · anon: solo dos lecturas ═══════════════════════════════════════════
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon' and not (privilege_type = 'SELECT' and table_name in ('catalog_public', 'landing_content'));
  perform tests.eq(n, 0, 'N · anon no tiene ningún privilegio fuera de catalog_public/landing_content SELECT');
  perform tests.act_as_anon();
  perform tests.lives('select count(*) from public.catalog_public', 'anon lee catalog_public');
  perform tests.lives('select count(*) from public.landing_content', 'anon lee landing_content');
  perform tests.throws('update public.catalog_public set name = ''HACKED''', 'permission denied', 'N · anon ya NO escribe products a través de catalog_public (P0 cerrado)');
  perform tests.throws('delete from public.catalog_public', 'permission denied', 'N · anon ya NO borra products a través de catalog_public');
  perform tests.throws('select count(*) from public.products', 'permission denied', 'anon sin products');
  perform tests.throws('select count(*) from public.profiles', 'permission denied', 'anon sin profiles');
  perform tests.throws('select count(*) from public.prospects', 'permission denied', 'anon sin prospects');
  perform tests.throws('select public.confirmar_entrega(gen_random_uuid(), null, null)', 'permission denied', 'anon ya no ejecuta confirmar_entrega');
  perform tests.lives('select public.is_verified()', 'anon puede evaluar helpers de políticas (false)');
  perform tests.act_as_owner();

  -- ══ vistas: solo lectura para todos los clientes ═════════════════════════
  select count(*) into n from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = g.table_schema
   where g.table_schema = 'public' and c.relkind = 'v' and g.grantee in ('anon', 'authenticated') and g.privilege_type <> 'SELECT';
  perform tests.eq(n, 0, 'ninguna vista concede INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER');
  select string_agg(price::text, ',') into v_antes from public.products where id = v_p;
  perform tests.act_as(v_doc);
  perform tests.throws('update public.products_safe set price = 1', 'permission denied', 'O · doctor verificado ya NO cambia precios vía products_safe (P0 cerrado)');
  perform tests.act_as(v_wh);
  perform tests.throws('update public.doctor_directory set organization = ''X''', 'permission denied', 'O · staff no edita perfiles ajenos vía doctor_directory');
  perform tests.throws('update public.v_stock_disponible set propio = 0', 'permission denied', 'O · nadie edita lotes vía v_stock_disponible');
  perform tests.act_as_owner();
  perform tests.eq((select price from public.products where id = v_p), 100::numeric, 'el precio sigue intacto');

  -- ══ authenticated: escrituras solo con política ══════════════════════════
  for r in select g.table_name, g.privilege_type from information_schema.role_table_grants g
            join pg_class c on c.relname = g.table_name join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
           where g.table_schema = 'public' and g.grantee = 'authenticated' and c.relkind = 'r' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE') loop
    perform tests.ok(exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.table_name
                               and p.cmd in (r.privilege_type, 'ALL') and (p.roles && array['authenticated', 'public']::name[])),
      'O · authenticated ' || r.privilege_type || ' en ' || r.table_name || ' tiene política');
  end loop;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  perform tests.eq(n, 0, 'O · nadie tiene TRUNCATE/REFERENCES/TRIGGER');
  perform tests.eq((select count(*)::int from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0,
    'todas las tablas con RLS');
  -- lo que sí escribe el cliente con política sigue concedido
  perform tests.ok(has_table_privilege('authenticated', 'public.profiles', 'UPDATE') and has_table_privilege('authenticated', 'public.notifications', 'INSERT')
               and has_table_privilege('authenticated', 'public.messages', 'INSERT') and has_table_privilege('authenticated', 'public.prospects', 'UPDATE')
               and has_table_privilege('authenticated', 'public.customers', 'UPDATE') and has_table_privilege('authenticated', 'public.products', 'UPDATE'),
    'O · escrituras legítimas del frontend conservadas (profiles, notifications, messages, prospects, customers, products)');
  perform tests.ok(not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT') and not has_table_privilege('authenticated', 'public.roles', 'UPDATE')
               and not has_table_privilege('authenticated', 'public.comm_outbox', 'UPDATE') and not has_table_privilege('authenticated', 'public.rate_limit_buckets', 'SELECT'),
    'O · sin política = sin grant (audit_logs, roles, comm_outbox, rate_limit_buckets)');

  -- ══ P · RPC legítimas siguen ejecutables; Q · realtime intacto ═══════════
  perform tests.act_as(v_doc);
  perform tests.lives('select public.is_verified()', 'P · doctor ejecuta is_verified()');
  perform tests.lives('select public.puede_ver_precio()', 'P · doctor ejecuta puede_ver_precio()');
  perform tests.lives('select count(*) from public.products_safe', 'P · doctor lee products_safe');
  perform tests.act_as(v_admin);
  perform tests.lives('select public.kpi_ventas()', 'P · Dirección ejecuta kpi_ventas()');
  perform tests.lives('select public.salud_sistema()', 'P · Dirección ejecuta salud_sistema()');
  perform tests.lives('select public.log_audit(''prueba'', ''x'', null, null)', 'P · log_audit sigue');
  perform tests.lives('insert into public.notifications (body, roles) values (''prueba'', array[''admin''])', 'P · insert con política sigue');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('messages', 'conversations', 'notifications')) = 3,
    'Q · publicación realtime intacta');
  perform tests.ok(has_table_privilege('authenticated', 'public.messages', 'SELECT') and has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
    'Q · lecturas que alimentan realtime conservadas');

  -- ══ L · defaults: un objeto nuevo ya no se abre a anon ═══════════════════
  create table public._cc0b_sandbox (id int);
  create view public._cc0b_sandbox_v as select id from public._cc0b_sandbox;
  create function public._cc0b_sandbox_f() returns int language sql as $$ select 1 $$;
  perform tests.ok(not has_table_privilege('anon', 'public._cc0b_sandbox', 'SELECT') and not has_table_privilege('anon', 'public._cc0b_sandbox_v', 'SELECT'),
    'L · tabla y vista nuevas: anon sin privilegios por defecto');
  -- Funciones: anon ya no recibe un grant explícito; sigue el EXECUTE implícito de PUBLIC
  -- (default de PostgreSQL, lo necesitan los helpers de las políticas). Decisión del dueño.
  perform tests.ok((select proacl is null or proacl::text not like '%anon=%' from pg_proc where oid = 'public._cc0b_sandbox_f()'::regprocedure),
    'L · función nueva: sin grant explícito a anon (queda solo el PUBLIC implícito de PostgreSQL)');
  perform tests.ok(has_table_privilege('authenticated', 'public._cc0b_sandbox', 'SELECT') and has_function_privilege('authenticated', 'public._cc0b_sandbox_f()', 'EXECUTE'),
    'L · authenticated conserva el default (decisión del dueño pendiente)');
  drop function public._cc0b_sandbox_f(); drop view public._cc0b_sandbox_v; drop table public._cc0b_sandbox;
end $t$;
rollback;
