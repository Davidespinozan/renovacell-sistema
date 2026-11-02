-- ============================================================================
-- IA CLÍNICA (2 nov 2026) · el dueño autorizó publicar la información clínica aprobada (T2) a doctores verificados.
-- cc_ia_contexto_actor agrega `clinico`: true cuando ese actor ya puede VER secciones T2 (audiencia verified o staff y
-- Dirección con T2 habilitado). La IA lo usa para responder preguntas de etiqueta con las secciones clínicas aprobadas
-- en vez del límite fijo; el contenido sigue saliendo solo de _cc_secciones_visibles (misma compuerta que la ficha).
-- Todo lo demás de la función queda idéntico.
-- ============================================================================
create or replace function public.cc_ia_contexto_actor(p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare p record; v_aud text; v_t2 boolean;
begin
  perform public._cc_solo_servicio();
  if p_profile is null then
    return jsonb_build_object('actor', 'visitor', 'audiencia', 'public', 'puede_precio', false, 'puede_stock', false, 'puede_pedidos', false, 'verificado', false, 'rol', '', 'clinico', false);
  end if;
  select role_id, active, verified, price_list_id into p from public.profiles where id = p_profile;
  if not found or not coalesce(p.active, false) then
    return jsonb_build_object('actor', 'suspendido', 'audiencia', 'public', 'puede_precio', false, 'puede_stock', false, 'puede_pedidos', false, 'verificado', false, 'rol', coalesce(p.role_id, ''), 'clinico', false);
  end if;
  v_aud := case when p.role_id = 'admin' then 'staff' when p.role_id = 'doctor' then case when p.verified then 'verified' else 'public' end else 'verified' end;
  v_t2 := coalesce((select t2_habilitado from public.cc_knowledge_config where id = 'default'), false);
  return jsonb_build_object(
    'actor', case when p.role_id = 'doctor' then 'doctor' when p.role_id = 'admin' then 'admin' else 'staff' end,
    'audiencia', v_aud,
    'puede_precio', coalesce(p.role_id, '') <> '' and (p.role_id <> 'doctor' or coalesce(p.verified, false)),   -- = puede_ver_precio() para ese perfil
    'puede_stock',  coalesce(p.role_id, '') <> '' and (p.role_id <> 'doctor' or coalesce(p.verified, false)),
    'puede_pedidos', p.role_id = 'doctor',
    'verificado', coalesce(p.verified, false), 'rol', coalesce(p.role_id, ''),
    'clinico', v_t2 and v_aud in ('verified', 'staff'));
end;
$$;
alter function public.cc_ia_contexto_actor(uuid) owner to postgres;
revoke all on function public.cc_ia_contexto_actor(uuid) from public, anon, authenticated;
grant execute on function public.cc_ia_contexto_actor(uuid) to service_role;
