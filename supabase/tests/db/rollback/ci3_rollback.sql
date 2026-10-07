-- Commercial Intent · CI-3 (129) · el down retira cc_messages de supabase_realtime sin tocar datos ni permisos.
begin;
create temp table _ci3_antes as select (select count(*) from public.cc_messages) m, (select count(*) from pg_policy where polrelid = 'public.cc_messages'::regclass) p;
\ir ../../../rollback/ci3/99_down.sql
do $t$
begin
  perform tests.ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'cc_messages'), '129 down · cc_messages fuera de la publicación');
  perform tests.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'), '129 down · las demás tablas siguen publicadas');
  perform tests.ok((select m = (select count(*) from public.cc_messages) and p = (select count(*) from pg_policy where polrelid = 'public.cc_messages'::regclass) from _ci3_antes), '129 down · sin cambios de datos ni políticas');
end $t$;
\ir ../../../rollback/ci3/99_down.sql
do $t$ begin perform tests.ok(true, '129 down · idempotente (segunda ejecución sin error)'); end $t$;
rollback;
