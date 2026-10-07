-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK · CI-3 (migración 129) → 128. Retira public.cc_messages de supabase_realtime (si está). No toca datos;
-- el chat sigue funcionando con el sondeo de 30 s.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $c$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cc_messages') then
    alter publication supabase_realtime drop table public.cc_messages;
  end if;
end $c$;
