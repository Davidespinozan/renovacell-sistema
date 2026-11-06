-- PASAR CONVERSACIÓN (5 nov 2026, dueño): «cuando pase algo así, que entre ellos mismos se la puedan pasar a otro vendedor».
-- Caso real: la Dra. María José Vea (cliente de Roberto) escribió por WhatsApp, su número no estaba ligado a su ficha, el
-- reparto la dio a Alejandra y solo Dirección podía reasignar (y solo ANTES de iniciar la asesoría).
--
-- cc_pasar_conversacion: el vendedor que TIENE la conversación (o Dirección) la pasa a otro vendedor que pueda atender,
-- con motivo, aunque la asesoría ya esté iniciada. Reutiliza _cc_handler_asignar (mismo camino que el reparto y la
-- reasignación de Dirección): el nuevo vendedor recibe el aviso «(reasignada a ti)» y la conversación queda asignada
-- para que la inicie; el anterior sale de los participantes. La cartera NO cambia (como cc_solicitud_reasignar):
-- para que el cliente quede con otro vendedor se usa «Vincular a un cliente» o el cambio de vendedor de su ficha.
-- cc_vendedores_traspaso: a quién se le puede pasar (vendedores que pueden atender), para vendedores y Dirección.

create or replace function public.cc_pasar_conversacion(p_conv uuid, p_vendedor uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_rol text := public.auth_role(); c record; r jsonb;
  v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 200)), '');
begin
  if v_uid is null or v_rol not in ('pos', 'admin') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_motivo is null then raise exception 'MOTIVO_REQUERIDO: di por qué la pasas (p. ej. «ya es cliente de Roberto»)' using errcode = 'check_violation'; end if;
  if p_vendedor is null then raise exception 'VENDEDOR_REQUERIDO: elige a quién se la pasas' using errcode = 'check_violation'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  -- solo quien la tiene asignada; Dirección puede pasar cualquiera
  if v_rol <> 'admin' and c.seller_profile_id is distinct from v_uid then
    raise exception 'NO_ES_TUYA: solo quien atiende la conversación puede pasarla' using errcode = 'insufficient_privilege';
  end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo not in ('human_requested', 'human_assigned', 'human_active') then
    raise exception 'SIN_ATENCION_HUMANA: la conversación la atiende el asistente; no hay a quién pasarla' using errcode = 'check_violation';
  end if;
  if c.seller_profile_id is not distinct from p_vendedor then raise exception 'MISMO_VENDEDOR: ya la tiene esa persona' using errcode = 'check_violation'; end if;
  if not public._cc_vendedor_elegible(p_vendedor, false) then
    raise exception 'VENDEDOR_NO_ELEGIBLE: activo, de ventas y con "Atender conversaciones"' using errcode = 'check_violation';
  end if;
  r := public._cc_handler_asignar(p_conv, p_vendedor, case when v_rol = 'admin' then 'admin' else 'seller' end, v_uid, v_motivo, 'traspaso');
  return r || jsonb_build_object('vendedor', p_vendedor,
    'vendedor_nombre', (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = p_vendedor));
end;
$$;

create or replace function public.cc_vendedores_traspaso()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or public.auth_role() not in ('pos', 'admin') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', coalesce(p.meta ->> 'name', p.full_name, p.email)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
    from public.profiles p where p.role_id = 'pos' and p.id <> auth.uid() and public._cc_vendedor_elegible(p.id, false)), '[]'::jsonb);
end;
$$;

revoke all on function public.cc_pasar_conversacion(uuid, uuid, text) from public, anon;
revoke all on function public.cc_vendedores_traspaso() from public, anon;
grant execute on function public.cc_pasar_conversacion(uuid, uuid, text) to authenticated;
grant execute on function public.cc_vendedores_traspaso() to authenticated;
