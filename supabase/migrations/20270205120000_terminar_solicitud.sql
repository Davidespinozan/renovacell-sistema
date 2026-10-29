-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- TERMINAR SOLICITUD (29 oct 2026) · dueño: "no hay manera de terminar conversaciones".
--   cc_terminar_asesoria solo aceptaba una asesoría INICIADA (human_active / human_ended). Una solicitud que nadie
--   tomó (human_requested, p.ej. un visitante sin vendedor) o asignada sin iniciar (human_assigned) se quedaba para
--   siempre en "Requiere tu intervención" y en la Bandeja. Ahora también se puede terminar desde esos estados:
--     · Dirección: cualquiera.   · Vendedor: solo la que tiene asignada (y puede atender).
--   El cierre es el mismo de siempre: se cierra la sesión actual, el modo vuelve a ai_active y se limpia quién
--   atiende / ruteo / handoff / reparto. Conversación, mensajes, cartera, carrito y pedidos NO cambian.
--   human_offered (la IA ofreció asesor y nadie lo pidió) sigue sin ser "terminable": no hay solicitud.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public.cc_terminar_asesoria(uuid,uuid)'::regprocedure)) <> '64d8cc8b8edc2457ec622d79734825db' then
    raise exception 'TERMINAR-SOLICITUD: cc_terminar_asesoria cambió desde la auditoría; revisar antes de aplicar'; end if;
end $pre$;

create or replace function public.cc_terminar_asesoria(p_conv uuid, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$function$
-- Chat V2-C1 · Terminar la atención = CERRAR LA SESIÓN ACTUAL. La conversación (relación permanente), sus
-- mensajes, eventos, la cartera, el carrito y los pedidos NO cambian. Se libera el estado operativo: modo
-- vuelve a ai_active (la IA vuelve a ser elegible) y se limpia quién atiende / ruteo / handoff / marcas.
-- TERMINAR-SOLICITUD · también desde una solicitud sin iniciar (human_requested / human_assigned).
declare c record; v_rol text; v_actor text; v_sesion uuid; v_ord int; v_iniciada boolean;
begin
  v_rol := public._cc_perfil_activo(p_profile);
  if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_actor := case when v_rol = 'admin' then 'admin' else 'seller' end;
  if c.modo not in ('human_active', 'human_ended', 'human_requested', 'human_assigned') then
    -- Idempotencia segura: quien cerró la última sesión (o Dirección) recibe el resultado, sin efectos.
    if c.modo in ('ai_active', 'human_offered')
       and (v_rol = 'admin' or exists (select 1 from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'cerrada' and s.closed_by_profile_id = p_profile)) then
      return jsonb_build_object('modo', c.modo, 'idempotente', true);
    end if;
    if not (v_rol = 'admin' or coalesce(c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile), false)) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- NULL-safe (tras un cierre no hay handler)
    raise exception 'TRANSICION_INVALIDA: % → human_ended (no hay solicitud ni asesoría que terminar)', c.modo using errcode = 'check_violation';
  end if;
  -- Sin vendedor (human_requested sin asignar) solo Dirección puede terminarla; NULL-safe.
  if not (v_rol = 'admin' or coalesce(c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile), false)) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_iniciada := c.modo in ('human_active', 'human_ended');
  if c.modo = 'human_active' then
    perform public._cc_cambiar_modo(p_conv, 'human_ended', 'human_ended', v_actor, p_profile, null);
  end if;
  -- El aviso de cierre pertenece a la sesión que termina (se inserta ANTES de cerrarla).
  perform public._cc_sistema(p_conv,
    case when v_iniciada then 'La asesoría terminó. Puedes seguir con el asistente cuando quieras.'
         else 'Cerramos esta solicitud de asesor. Puedes seguir con el asistente o volver a pedir un asesor cuando quieras.' end,
    'sys:fin:' || c.ultimo_seq);
  v_sesion := public._cc_sesion_cerrar(p_conv, case when v_rol = 'admin' then 'direccion_finalizo' else 'asesor_finalizo' end, v_actor, p_profile);
  update public.cc_participants set left_at = now() where conversation_id = p_conv and rol = 'asesor' and left_at is null;
  update public.cc_conversations
     set modo = 'ai_active', seller_profile_id = null, ruteo_motivo = null, handoff_origen = null, handoff_cart_id = null, handoff_fuera_horario = null,
         asesoria_solicitada_at = null, asesoria_asignada_at = null, asesoria_iniciada_at = null, asesoria_terminada_at = null,
         reparto_probados = '{}', reparto_at = null, updated_at = now()
   where id = p_conv;
  select ordinal into v_ord from public.cc_conversation_sessions where id = v_sesion;
  return jsonb_build_object('modo', 'ai_active', 'idempotente', false, 'sesion_id', v_sesion, 'sesion_ordinal', v_ord, 'iniciada', v_iniciada);
end;
$function$;

do $post$ begin
  if position('human_requested' in pg_get_functiondef('public.cc_terminar_asesoria(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'TERMINAR-SOLICITUD: la función no quedó aplicada'; end if;
end $post$;
