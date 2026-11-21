-- CAJAS-MEDIOS · la IA necesita saber qué productos se guardan por MEDIA CAJA para hablar en cajas (ver _shared/ia/cajas.ts).
create or replace function public.cc_ia_media_caja()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(id), '{}') from public.products where active and unit ilike 'media caja%';
$$;
revoke all on function public.cc_ia_media_caja() from public, anon, authenticated;
grant execute on function public.cc_ia_media_caja() to service_role;
