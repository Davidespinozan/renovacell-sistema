-- SIN-INE (0757) · down: el portal vuelve a pedir las fotos de la INE y los avisos vuelven a mencionarla.

CREATE OR REPLACE FUNCTION public.mi_verificacion()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Solo lo del propio doctor. Rechazado = el último dictamen fue 'rejected' (Dirección o vendedor) y sigue sin acceso.
declare p record; ev jsonb;
begin
  select id, role_id, verified, meta into p from public.profiles where id = auth.uid();
  if not found or p.role_id <> 'doctor' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  ev := coalesce(p.meta -> 'identity' -> 'evidence', '{}'::jsonb);
  return jsonb_build_object(
    'verificado', p.verified,
    'estado', case when p.verified then 'verified' when p.meta -> 'verification' ->> 'status' in ('rejected', 'revoked') then p.meta -> 'verification' ->> 'status' else 'pending' end,
    'motivo', case when not p.verified then p.meta -> 'verification' ->> 'reason' end,
    'revisado_at', p.meta -> 'verification' ->> 'reviewed_at',
    'cedula', p.meta ->> 'cedula',
    'faltan', to_jsonb(array_remove(array[
        case when nullif(btrim(coalesce(p.meta ->> 'cedula', '')), '') is null then 'cedula' end,
        case when not ev ? 'ine-front' then 'ine-front' end,
        case when not ev ? 'ine-back' then 'ine-back' end], null)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.verificacion_avisar(p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p record; v_seller uuid; v_nombre text; v_asignado boolean := false; v_reparto boolean := false;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select id, full_name, verified, meta into p from public.profiles where id = p_profile and role_id = 'doctor';
  if not found or p.verified then return jsonb_build_object('avisado', false); end if;
  v_nombre := coalesce(nullif(btrim(p.full_name), ''), p.meta ->> 'name', 'Un doctor');
  v_seller := public._vendedor_de_doctor(p_profile);
  if v_seller is not null and public._rol_de_perfil(v_seller) = 'admin' then v_seller := null; end if;   -- Dirección ya no verifica
  if v_seller is not null and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_profile, v_seller, now(), null, 'Atendió su registro');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_profile, null, v_seller, null, 'Atendió su registro');
    v_asignado := true;
  end if;
  if v_seller is not null then
    -- Una clave por minuto: si corrige y vuelve a mandar, vuelve a avisar; un doble envío no duplica.
    perform public._cc_notificar('verificacion_por_revisar', null, array[v_seller], null,
      v_nombre || ' mandó su verificación: revisa su cédula y su INE y apruébalo', 'clientes',
      'verif_aviso:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  else
    -- REPARTO-VERIF · sin vendedor: al azar. Si ya le había tocado a alguien (corrigió y reenvió), sigue con esa persona.
    select seller_profile_id into v_seller from public.cc_verif_reparto where profile_id = p_profile and public._cc_vendedor_elegible(seller_profile_id, true);
    if v_seller is not null then
      perform public._cc_notificar('verificacion_por_revisar', null, array[v_seller], null,
        v_nombre || ' volvió a mandar su verificación: revisa su cédula y su INE', 'clientes',
        'verif_aviso:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    else
      v_seller := public._verif_reparto_asignar(p_profile);
    end if;
    v_reparto := v_seller is not null;
  end if;
  return jsonb_build_object('avisado', true, 'seller', v_seller, 'asignado', v_asignado, 'reparto', v_reparto, 'nombre', v_nombre);
end;
$function$;

CREATE OR REPLACE FUNCTION public._verif_reparto_asignar(p_profile uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.cc_verif_reparto; s uuid; v_nombre text;
begin
  select * into v from public.cc_verif_reparto where profile_id = p_profile for update;
  s := public._cc_vendedor_azar(coalesce(v.probados, '{}'));
  if s is null and v.profile_id is not null then   -- ya pasó por todos: nueva vuelta (sin repetir al último si hay otro)
    s := coalesce(public._cc_vendedor_azar(array[v.seller_profile_id]), public._cc_vendedor_azar('{}'));
    if s is not null then update public.cc_verif_reparto set probados = '{}', vueltas = vueltas + 1 where profile_id = p_profile; end if;
  end if;
  select coalesce(nullif(btrim(full_name), ''), meta ->> 'name', 'Un doctor') into v_nombre from public.profiles where id = p_profile;
  if s is null then
    perform public._cc_notificar('verificacion_por_revisar', null, null, array['admin'], v_nombre || ' espera verificación y no hay vendedores que reciban clientes nuevos', 'av_verif',
      'verif_sin_vendedores:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
    return null;
  end if;
  insert into public.cc_verif_reparto (profile_id, seller_profile_id, asignado_at, probados) values (p_profile, s, now(), array[s])
  on conflict (profile_id) do update set seller_profile_id = s, asignado_at = now(), probados = array_append(public.cc_verif_reparto.probados, s);
  perform public._cc_notificar('verificacion_por_revisar', null, array[s], null,
    'Te tocó verificar a ' || v_nombre || ': revisa su cédula y su INE y apruébalo', 'clientes',
    'verif_reparto:' || p_profile::text || ':' || s::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  return s;
end;
$function$;
