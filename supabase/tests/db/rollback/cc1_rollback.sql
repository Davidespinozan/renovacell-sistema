-- CC-1 · El rollback retira el dominio de visitante y devuelve el dedupe a CC-0B.
begin;
-- Rollback EN CAPAS (como W1/W2): CC-3 reutiliza _cc_append_only y CC-2 se apoya en cc_visitors
-- (FK restrict), así que bajan primero, en orden inverso.
\ir ../../../rollback/chv2a/99_down.sql   -- CHV2-A (123) se baja primero
\ir ../../../rollback/c360_f3/99_down.sql   -- C360-F3 (121) se baja primero
\ir ../../../rollback/c360_0/99_down.sql   -- C360-0 (120) se baja primero
\ir ../../../rollback/cc7/99_down.sql   -- CC-7 se baja primero (depende de CC-2/5/6)
\ir ../../../rollback/cc6/99_down.sql
\ir ../../../rollback/cc5/99_down.sql
\ir ../../../rollback/cc4/99_down.sql
\ir ../../../rollback/cc3/99_down.sql
\ir ../../../rollback/cc2/99_down.sql
\ir ../../../rollback/cc1/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_visitors') is null and to_regclass('public.cc_visitor_events') is null and to_regclass('public.cc_referral_codes') is null, 'tablas cc_* retiradas');
  perform tests.ok(to_regprocedure('public.cc_visitante_adoptar(text,uuid)') is null and to_regprocedure('public.cc_visitante_abrir(text,text,jsonb,text)') is null
               and to_regprocedure('public.norm_telefono_mx(text)') is null, 'funciones CC-1 retiradas');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospects' and column_name = 'visitor_id'), 'prospects.visitor_id retirada');
  perform tests.ok(exists (select 1 from pg_indexes where indexname = 'idx_prospects_phone_digits') and not exists (select 1 from pg_indexes where indexname = 'idx_prospects_phone_norm'), 'índice de dedupe CC-0B restaurado');
  perform tests.ok(pg_get_functiondef('public.buscar_prospecto_duplicado(text,text)'::regprocedure) like '%>= 7%' and pg_get_functiondef('public.buscar_prospecto_duplicado(text,text)'::regprocedure) not like '%norm_telefono_mx%', 'dedupe vuelve a la regla CC-0B');
  perform tests.ok(has_function_privilege('service_role', 'public.buscar_prospecto_duplicado(text,text)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.buscar_prospecto_duplicado(text,text)', 'EXECUTE'), 'privilegios del dedupe iguales a CC-0B');
end $t$;
rollback;
