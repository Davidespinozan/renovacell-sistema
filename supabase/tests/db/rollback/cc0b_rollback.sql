-- CC-0B · El rollback retira limitador, dedupe e índices y devuelve los privilegios por
-- defecto de anon; NO reabre los privilegios retirados (decisión documentada).
begin;
\ir ../../../rollback/cc0b/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.rate_limit_buckets') is null and to_regprocedure('public.rate_limit_hit(text,text,int,int,int)') is null,
    'limitador retirado');
  perform tests.ok(to_regprocedure('public.buscar_prospecto_duplicado(text,text)') is null, 'dedupe retirado');
  perform tests.ok(not exists (select 1 from pg_indexes where indexname in ('idx_prospects_email_lower', 'idx_prospects_phone_digits')), 'índices retirados');
  perform tests.ok(exists (select 1 from pg_default_acl d join pg_namespace ns on ns.oid = d.defaclnamespace
                            where ns.nspname = 'public' and d.defaclrole = 'postgres'::regrole and d.defaclacl::text like '%anon=%'),
    'defaults de anon restaurados');
  perform tests.ok(not has_table_privilege('anon', 'public.products', 'SELECT') and not has_table_privilege('authenticated', 'public.products_safe', 'UPDATE'),
    'la higiene de privilegios se conserva (no se reabre el P0)');
end $t$;
rollback;
