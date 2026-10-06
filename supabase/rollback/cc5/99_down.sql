-- ============================================================================
-- CC-5 · ROLLBACK. Retira el carrito y devuelve cc_visitante_adoptar / cc_visitantes_purgar a su
-- texto CC-2. Los carritos locales se pierden (CC-5 nunca llegó a producción). UNA transacción.
-- ============================================================================
drop function if exists public.cc_carrito_preparar_checkout(uuid, text, text, uuid);
drop function if exists public.cc_carrito_oferta(uuid, text, text, uuid, text);
drop function if exists public.cc_carrito_vaciar(uuid, text, text, uuid, text);
drop function if exists public.cc_carrito_quitar(uuid, text, text, uuid, uuid, text);
drop function if exists public.cc_carrito_actualizar(uuid, text, text, uuid, uuid, int, text);
drop function if exists public.cc_carrito_agregar(uuid, text, text, uuid, uuid, int, text);
drop function if exists public._cc_cart_mutar(uuid, text, text, uuid, text, uuid, int, text);
drop function if exists public.cc_carrito_ver(uuid, text, text, uuid);
drop function if exists public.cc_carrito_abrir(text, text, uuid, uuid);
drop function if exists public.cc_carrito_proyeccion(uuid, uuid);
drop function if exists public._cc_cart_actor(text, text, uuid);
drop function if exists public._cc_cart_registrar_op(uuid, text, jsonb, jsonb);
drop function if exists public._cc_cart_operacion(uuid, text, jsonb);
drop function if exists public._cc_cart_activo(text, uuid, uuid, uuid);
drop function if exists public._cc_cart_autoridad(uuid, text, uuid, uuid);
drop function if exists public._cc_cart_evento(uuid, text, text, uuid, uuid, uuid, int, int, jsonb);

-- cc_visitante_adoptar: texto CC-2 (con conversaciones, sin carritos).
create or replace function public.cc_visitante_adoptar(p_hash text, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  prof record; v public.cc_visitors%rowtype; n int := 0; r record; convs int := 0;
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
    convs := public._cc_adoptar_conversaciones(v.id, p_profile);   -- CC-2
    return jsonb_build_object('estado', 'adoptado', 'visitor_id', v.id, 'adoptados', 1, 'conversaciones', convs);
  end if;

  for r in select id from public.cc_visitors where pending_profile_id = p_profile and estado = 'activo' order by created_at for update loop
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = r.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (r.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (r.id, 'revocado', '{"motivo":"adopcion"}');
    convs := convs + public._cc_adoptar_conversaciones(r.id, p_profile);   -- CC-2
    n := n + 1;
  end loop;
  return jsonb_build_object('estado', case when n > 0 then 'adoptado' else 'nada' end, 'adoptados', n, 'conversaciones', convs);
end;
$$;

-- cc_visitantes_purgar: texto CC-2.
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
     and not exists (select 1 from public.prospects p where p.visitor_id = v.id)
     and not exists (select 1 from public.cc_conversations c where c.visitor_id = v.id)
     and not exists (select 1 from public.cc_messages m where m.actor_visitor_id = v.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

drop function if exists public._cc_adoptar_carritos(uuid, uuid);
drop table if exists public.cc_cart_events;
drop table if exists public.cc_cart_operations;
drop table if exists public.cc_cart_items;
drop table if exists public.cc_carts;
