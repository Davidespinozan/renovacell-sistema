-- ============================================================================
-- RESPUESTAS RÁPIDAS CON FOTOS (24 nov 2026, Ventas: «¿no hay forma de que en las respuestas rápidas pueda anexar fotos?»).
--   · Cada respuesta guarda hasta 4 fotos (cc_respuestas_rapidas.fotos = rutas del bucket privado «respuestas»).
--   · Las sube quien la escribe (Dirección o vendedor) a su carpeta <uid>/…; las lee todo el que usa respuestas (admin, pos).
--   · Al elegirla en el chat, las fotos salen por el MISMO camino que el botón de fotos (adjuntar): portal y WhatsApp.
--   · cc_respuesta_guardar gana p_fotos: null = no tocar las fotos (pantallas viejas aún abiertas), [] = quitarlas.
-- Rollback: supabase/rollback/respuestas_con_fotos/99_down.sql
-- ============================================================================
do $pre$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cc_respuestas_rapidas' and column_name = 'fotos') then
    raise exception 'RR-FOTOS: ya aplicada'; end if;
end $pre$;

alter table public.cc_respuestas_rapidas add column fotos jsonb not null default '[]'::jsonb;
alter table public.cc_respuestas_rapidas add constraint ck_rr_fotos check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 4);
comment on column public.cc_respuestas_rapidas.fotos is 'Rutas (bucket respuestas) de las fotos que salen con la respuesta; máximo 4';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('respuestas', 'respuestas', false, 3145728, array['image/jpeg', 'image/png']);

create policy respuestas_fotos_leer on storage.objects for select to authenticated
  using (bucket_id = 'respuestas' and public.auth_role() in ('admin', 'pos'));
create policy respuestas_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'respuestas' and public.auth_role() in ('admin', 'pos') and split_part(name, '/', 1) = auth.uid()::text and split_part(name, '/', 2) <> '');

drop function public.cc_respuesta_guardar(uuid, text, text, boolean);
create function public.cc_respuesta_guardar(p_id uuid, p_titulo text, p_texto text, p_empresa boolean, p_fotos jsonb default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- Alta o edición. Propias: cualquier vendedor o Dirección. De la empresa (sin dueño): solo Dirección.
-- RR-FOTOS · p_fotos: arreglo de hasta 4 rutas ya subidas al bucket «respuestas»; null = conservar las que tenga.
declare v_rol text := public.auth_role(); v_uid uuid := auth.uid(); r public.cc_respuestas_rapidas; v_id uuid;
  v_titulo text := btrim(coalesce(p_titulo, '')); v_texto text := btrim(coalesce(p_texto, '')); f text;
begin
  if v_uid is null or v_rol not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if length(v_titulo) not between 2 and 40 or length(v_texto) not between 2 and 1000 then raise exception 'DATOS_INVALIDOS: título de 2 a 40 y texto de 2 a 1000 caracteres' using errcode = 'check_violation'; end if;
  if p_fotos is not null then
    if jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) > 4 then raise exception 'FOTOS_INVALIDAS: hasta 4 fotos' using errcode = 'check_violation'; end if;
    for f in select jsonb_array_elements_text(p_fotos) loop
      if f !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$' or not exists (select 1 from storage.objects o where o.bucket_id = 'respuestas' and o.name = f) then
        raise exception 'FOTOS_INVALIDAS: una foto no se subió bien' using errcode = 'check_violation'; end if;
    end loop;
  end if;
  if p_id is null then
    if coalesce(p_empresa, false) and v_rol <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección guarda respuestas de la empresa' using errcode = 'insufficient_privilege'; end if;
    insert into public.cc_respuestas_rapidas (profile_id, titulo, texto, fotos) values (case when coalesce(p_empresa, false) then null else v_uid end, v_titulo, v_texto, coalesce(p_fotos, '[]'::jsonb)) returning id into v_id;
    return v_id;
  end if;
  select * into r from public.cc_respuestas_rapidas where id = p_id for update;
  if not found or not (r.profile_id is not distinct from v_uid or (r.profile_id is null and v_rol = 'admin')) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_respuestas_rapidas set titulo = v_titulo, texto = v_texto, fotos = coalesce(p_fotos, fotos), updated_at = now() where id = p_id;
  return p_id;
end;
$function$;
revoke all on function public.cc_respuesta_guardar(uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.cc_respuesta_guardar(uuid, text, text, boolean, jsonb) to authenticated, service_role;
