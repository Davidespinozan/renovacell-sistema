-- Reversa de 20270328120000_equipo_lecturas.sql.
do $rt$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'equipo_lecturas') then
    alter publication supabase_realtime drop table public.equipo_lecturas;
  end if;
end $rt$;
drop function if exists public.equipo_lectores(uuid), public.equipo_escribiendo(uuid, boolean), public.equipo_leido(uuid, timestamptz);
drop table if exists public.equipo_lecturas;
