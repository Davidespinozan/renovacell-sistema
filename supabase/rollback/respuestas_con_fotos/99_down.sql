-- Rollback de 20270407910000_respuestas_con_fotos.sql: cc_respuesta_guardar vuelve a 4 argumentos y se quita la columna.
-- El bucket «respuestas» y sus políticas se quedan (Storage no deja borrar un bucket con archivos desde SQL); sin la
-- columna nadie los usa.
drop function public.cc_respuesta_guardar(uuid, text, text, boolean, jsonb);
CREATE OR REPLACE FUNCTION public.cc_respuesta_guardar(p_id uuid, p_titulo text, p_texto text, p_empresa boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Alta o edición. Propias: cualquier vendedor o Dirección. De la empresa (sin dueño): solo Dirección.
declare v_rol text := public.auth_role(); v_uid uuid := auth.uid(); r public.cc_respuestas_rapidas; v_id uuid;
  v_titulo text := btrim(coalesce(p_titulo, '')); v_texto text := btrim(coalesce(p_texto, ''));
begin
  if v_uid is null or v_rol not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if length(v_titulo) not between 2 and 40 or length(v_texto) not between 2 and 1000 then raise exception 'DATOS_INVALIDOS: título de 2 a 40 y texto de 2 a 1000 caracteres' using errcode = 'check_violation'; end if;
  if p_id is null then
    if coalesce(p_empresa, false) and v_rol <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección guarda respuestas de la empresa' using errcode = 'insufficient_privilege'; end if;
    insert into public.cc_respuestas_rapidas (profile_id, titulo, texto) values (case when coalesce(p_empresa, false) then null else v_uid end, v_titulo, v_texto) returning id into v_id;
    return v_id;
  end if;
  select * into r from public.cc_respuestas_rapidas where id = p_id for update;
  if not found or not (r.profile_id is not distinct from v_uid or (r.profile_id is null and v_rol = 'admin')) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_respuestas_rapidas set titulo = v_titulo, texto = v_texto, updated_at = now() where id = p_id;
  return p_id;
end;
$function$;
revoke all on function public.cc_respuesta_guardar(uuid, text, text, boolean) from public, anon;
grant execute on function public.cc_respuesta_guardar(uuid, text, text, boolean) to authenticated, service_role;
alter table public.cc_respuestas_rapidas drop constraint ck_rr_fotos;
alter table public.cc_respuestas_rapidas drop column fotos;
