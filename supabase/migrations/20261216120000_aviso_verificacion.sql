-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- AVISO DE VERIFICACIÓN A SU VENDEDORA (migración 163)
--   Pedido del dueño (15 oct 2026): cuando el cliente manda su verificación (registro en la landing, en el chat o
--   corrigiendo en "Mi verificación"), su vendedora se entera AL MOMENTO y la verifica ella misma.
--   · _vendedor_de_doctor(perfil)   NUEVA (interna). Su cartera; si no tiene, quien atiende su conversación (de su cuenta
--                                   o la del enlace con la que se registró); si no, la vendedora a la que se ruteó su
--                                   prerregistro.
--   · verificacion_avisar(perfil)   NUEVA (servidor). Encuentra a su vendedora; si el doctor no tenía cartera, queda en la
--                                   de ella (es quien lo atiende); le avisa, o a Dirección si no hay vendedora. Devuelve a
--                                   quién avisó (la Edge le manda además el aviso al teléfono).
--   · mis_por_verificar()           NUEVA. Los doctores pendientes que quien llama puede verificar (su cartera o Dirección),
--                                   con lo necesario para revisarlos sin que exista una conversación.
--   NO cambia: quién puede verificar (_puede_verificar), doctor_verificar ni la evidencia.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/aviso_verificacion/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.verificacion_avisar(uuid)') is not null then raise exception 'AVISO-VERIF: ya aplicada'; end if;
  if to_regprocedure('public._puede_verificar(uuid)') is null or to_regprocedure('public.doctor_verificacion_ver(uuid)') is null
     or to_regprocedure('public._cc_puede_atender(uuid)') is null or to_regclass('public.cc_prerregistros') is null then
    raise exception 'AVISO-VERIF: faltan piezas previas (150, 154)';
  end if;
end $pre$;

create function public._vendedor_de_doctor(p_profile uuid) returns uuid
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select k.seller_profile_id from public.cc_cartera k where k.profile_id = p_profile and public._cc_puede_atender(k.seller_profile_id)),
    (select c.seller_profile_id from public.cc_conversations c
      where c.profile_id = p_profile and c.estado = 'abierta' and c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id)
      order by c.last_message_at desc nulls last limit 1),
    (select c.seller_profile_id from public.cc_visitors v join public.cc_conversations c on c.visitor_id = v.id
      where (v.pending_profile_id = p_profile or v.adopted_profile_id = p_profile) and c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id)
      order by c.last_message_at desc nulls last limit 1),
    (select r.posible_seller_id from public.cc_visitors v join public.cc_prerregistros r on r.visitor_id = v.id
      where (v.pending_profile_id = p_profile or v.adopted_profile_id = p_profile) and r.posible_seller_id is not null and public._cc_puede_atender(r.posible_seller_id)
      order by r.created_at desc limit 1))
$$;

create function public.verificacion_avisar(p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare p record; v_seller uuid; v_nombre text; v_asignado boolean := false;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select id, full_name, verified, meta into p from public.profiles where id = p_profile and role_id = 'doctor';
  if not found or p.verified then return jsonb_build_object('avisado', false); end if;
  v_nombre := coalesce(nullif(btrim(p.full_name), ''), p.meta ->> 'name', 'Un doctor');
  v_seller := public._vendedor_de_doctor(p_profile);
  if v_seller is not null and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_profile, v_seller, now(), null, 'Atendió su registro');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_profile, null, v_seller, null, 'Atendió su registro');
    v_asignado := true;
  end if;
  -- Una clave por minuto: si corrige y vuelve a mandar, vuelve a avisar; un doble envío no duplica.
  if v_seller is not null then
    perform public._cc_notificar('verificacion_por_revisar', null, array[v_seller], null,
      v_nombre || ' mandó su verificación: revisa su cédula y su INE y apruébalo', 'clientes',
      'verif_aviso:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  else
    perform public._cc_notificar('verificacion_por_revisar', null, null, array['admin'],
      v_nombre || ' mandó su verificación (sin vendedora asignada)', 'av_verif',
      'verif_aviso:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end if;
  return jsonb_build_object('avisado', true, 'seller', v_seller, 'asignado', v_asignado, 'nombre', v_nombre);
end;
$$;

create function public.mis_por_verificar() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(public.doctor_verificacion_ver(x.id) order by x.cuando desc)
      from (select p.id, coalesce((p.meta -> 'verification' ->> 'resubmitted_at')::timestamptz, (select u.created_at from auth.users u where u.id = p.id)) cuando
              from public.profiles p
             where p.role_id = 'doctor' and not p.verified and coalesce(p.meta -> 'verification' ->> 'status', 'pending') = 'pending'
               and public._puede_verificar(p.id)
             order by 2 desc limit 50) x), '[]'::jsonb);
end;
$$;

alter function public._vendedor_de_doctor(uuid) owner to postgres;
alter function public.verificacion_avisar(uuid) owner to postgres;
alter function public.mis_por_verificar() owner to postgres;
revoke all on function public._vendedor_de_doctor(uuid), public.verificacion_avisar(uuid) from public, anon, authenticated;
grant execute on function public._vendedor_de_doctor(uuid), public.verificacion_avisar(uuid) to service_role;
revoke all on function public.mis_por_verificar() from public, anon;
grant execute on function public.mis_por_verificar() to authenticated, service_role;

do $post$ begin
  if has_function_privilege('authenticated', 'public.verificacion_avisar(uuid)', 'execute') or has_function_privilege('anon', 'public.mis_por_verificar()', 'execute') then
    raise exception 'AVISO-VERIF: permisos inesperados';
  end if;
end $post$;
