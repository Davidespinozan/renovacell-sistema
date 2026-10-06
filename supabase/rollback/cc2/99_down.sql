-- ============================================================================
-- CC-2 · ROLLBACK. Retira el dominio de conversación y devuelve cc_visitante_adoptar y
-- cc_visitantes_purgar a su texto CC-1. Las conversaciones locales se pierden (CC-2 nunca
-- llegó a producción con datos). Ejecutar en UNA transacción.
-- ============================================================================
drop function if exists public.cc_cola_asesorias();
drop function if exists public.cc_reabrir_conversacion(uuid, text, text, uuid);
drop function if exists public.cc_cerrar_conversacion(uuid, text, text, uuid);
drop function if exists public.cc_reanudar_ia(uuid, text, text, uuid);
drop function if exists public.cc_terminar_asesoria(uuid, uuid);
drop function if exists public.cc_iniciar_asesoria(uuid, uuid);
drop function if exists public.cc_asignar_asesor(uuid, uuid, uuid);
drop function if exists public.cc_solicitar_asesor(uuid, text, text, uuid);
drop function if exists public.cc_marcar_leido(uuid, text, text, uuid, bigint);
drop function if exists public.cc_enviar_mensaje(uuid, text, text, uuid, text, text);
drop function if exists public.cc_leer_conversacion(uuid, text, text, uuid, bigint, int);
drop function if exists public.cc_abrir_conversacion(text, uuid);

-- cc_visitante_adoptar: texto CC-1 (sin el gancho de conversación).
create or replace function public.cc_visitante_adoptar(p_hash text, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  prof record; v public.cc_visitors%rowtype; n int := 0; r record;
begin
  if p_profile is null then raise exception 'CC1_ARGUMENTOS: perfil requerido' using errcode = 'invalid_parameter_value'; end if;
  select id, active, role_id into prof from public.profiles where id = p_profile;
  if not found then raise exception 'PERFIL_INEXISTENTE'; end if;
  if not prof.active then raise exception 'CUENTA_SUSPENDIDA'; end if;

  if p_hash is not null then
    if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'SESION_INVALIDA'; end if;
    select * into v from public.cc_visitors where token_hash = p_hash and estado in ('activo', 'adoptado') for update;
    if not found then raise exception 'SESION_INVALIDA'; end if;
    if v.estado = 'adoptado' then
      if v.adopted_profile_id = p_profile then
        return jsonb_build_object('estado', 'ya_adoptado', 'visitor_id', v.id, 'adoptados', 0);
      end if;
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"adoptado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);
    end if;
    if v.pending_profile_id is not null and v.pending_profile_id <> p_profile then
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"registrado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);
    end if;
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = v.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (v.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (v.id, 'revocado', '{"motivo":"adopcion"}');
    return jsonb_build_object('estado', 'adoptado', 'visitor_id', v.id, 'adoptados', 1);
  end if;

  for r in select id from public.cc_visitors where pending_profile_id = p_profile and estado = 'activo' order by created_at for update loop
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = r.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (r.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (r.id, 'revocado', '{"motivo":"adopcion"}');
    n := n + 1;
  end loop;
  return jsonb_build_object('estado', case when n > 0 then 'adoptado' else 'nada' end, 'adoptados', n);
end;
$$;
revoke all on function public.cc_visitante_adoptar(text, uuid) from public, anon, authenticated;
grant execute on function public.cc_visitante_adoptar(text, uuid) to service_role;

create or replace function public.cc_visitantes_purgar(p_dias int default 90) returns int
language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if p_dias is null or p_dias < 30 then raise exception 'CC1_ARGUMENTOS: la retención mínima es 30 días' using errcode = 'invalid_parameter_value'; end if;
  perform set_config('app.cc_purga', 'on', true);
  delete from public.cc_visitors v
   where v.estado = 'activo' and v.adopted_profile_id is null and v.pending_profile_id is null
     and v.last_seen_at < now() - make_interval(days => p_dias)
     and not exists (select 1 from public.prospects p where p.visitor_id = v.id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.cc_visitantes_purgar(int) from public, anon, authenticated;
grant execute on function public.cc_visitantes_purgar(int) to service_role;

drop function if exists public._cc_adoptar_conversaciones(uuid, uuid);
drop table if exists public.cc_conversation_events;
drop table if exists public.cc_messages;
drop table if exists public.cc_participants;
drop table if exists public.cc_conversations;
drop function if exists public._cc_participante(uuid, text, uuid, uuid, text);
drop function if exists public._cc_autoridad(uuid, text, uuid, uuid);
drop function if exists public._cc_cambiar_modo(uuid, text, text, text, uuid, uuid, jsonb);
drop function if exists public._cc_transicion_valida(text, text);
drop function if exists public._cc_sistema(uuid, text, text);
drop function if exists public._cc_evento(uuid, text, text, uuid, uuid, jsonb);
drop function if exists public._cc_visitor_por_hash(text);
drop function if exists public._cc_perfil_activo(uuid);
drop function if exists public._cc_puede_atender(uuid);
