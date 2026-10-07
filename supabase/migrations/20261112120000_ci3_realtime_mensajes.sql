-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- COMMERCIAL INTENT · CI-3 (migración 129) · Realtime como DESPERTADOR del detector C4 (nunca autoridad).
--   · Única acción: agregar public.cc_messages a la publicación supabase_realtime (solo si no está ya).
--   · Seguridad: Realtime (Postgres Changes) aplica el RLS de la tabla con el JWT de cada suscriptor. La lectura
--     de cc_messages ya está concedida a `authenticated` y acotada por `ccm_select_propias` (dueño, vendedor
--     actual o Dirección): el canal entrega exactamente lo que PostgREST/`leer` ya permiten. NO se amplía
--     ningún permiso ni política. `anon` (visitantes) sigue sin acceso: el visitante queda en sondeo.
--   · cc_messages es append-only (trg_ccm_append_only): solo se publican INSERT. REPLICA IDENTITY por defecto basta.
--   · Guardas: se niega si la tabla perdió RLS, si `anon` puede leerla, si aparece otra política o si la
--     publicación fuera FOR ALL TABLES. No toca datos.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $ci3$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'CI-3: falta la publicación supabase_realtime';
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'CI-3: la publicación es FOR ALL TABLES (estado inesperado)';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.cc_messages'::regclass) then
    raise exception 'CI-3: cc_messages sin RLS — no se publica';
  end if;
  if has_table_privilege('anon', 'public.cc_messages', 'SELECT') then
    raise exception 'CI-3: anon puede leer cc_messages — no se publica';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.cc_messages'::regclass and polname <> 'ccm_select_propias')
     or not exists (select 1 from pg_policy where polrelid = 'public.cc_messages'::regclass and polname = 'ccm_select_propias' and polcmd = 'r') then
    raise exception 'CI-3: políticas de cc_messages distintas de la auditada (ccm_select_propias) — no se publica';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cc_messages') then
    alter publication supabase_realtime add table public.cc_messages;
  end if;
end $ci3$;
