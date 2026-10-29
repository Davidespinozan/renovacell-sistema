-- TERMINAR-SOLICITUD (20270205) · down: cc_terminar_asesoria vuelve a su definición exacta anterior.
CREATE OR REPLACE FUNCTION public.cc_terminar_asesoria(p_conv uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Chat V2-C1 · Terminar la atención = CERRAR LA SESIÓN ACTUAL. La conversación (relación permanente), sus
-- mensajes, eventos, la cartera, el carrito y los pedidos NO cambian. Se libera el estado operativo: modo
-- vuelve a ai_active (la IA vuelve a ser elegible) y se limpia quién atiende / ruteo / handoff / marcas.
declare c record; v_rol text; v_actor text; v_sesion uuid; v_ord int;
begin
  v_rol := public._cc_perfil_activo(p_profile);
  if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_actor := case when v_rol = 'admin' then 'admin' else 'seller' end;
  if c.modo not in ('human_active', 'human_ended') then
    -- Idempotencia segura: quien cerró la última sesión (o Dirección) recibe el resultado, sin efectos.
    if c.modo in ('ai_active', 'human_offered')
       and (v_rol = 'admin' or exists (select 1 from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'cerrada' and s.closed_by_profile_id = p_profile)) then
      return jsonb_build_object('modo', c.modo, 'idempotente', true);
    end if;
    if not (v_rol = 'admin' or coalesce(c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile), false)) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- NULL-safe (tras un cierre no hay handler)
    raise exception 'TRANSICION_INVALIDA: % → human_ended (la asesoría no está iniciada)', c.modo using errcode = 'check_violation';
  end if;
  if not (v_rol = 'admin' or coalesce(c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile), false)) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- NULL-safe (tras un cierre no hay handler)
  if c.modo = 'human_active' then
    perform public._cc_cambiar_modo(p_conv, 'human_ended', 'human_ended', v_actor, p_profile, null);
  end if;
  -- El aviso de cierre pertenece a la sesión que termina (se inserta ANTES de cerrarla).
  perform public._cc_sistema(p_conv, 'La asesoría terminó. Puedes seguir con el asistente cuando quieras.', 'sys:fin:' || c.ultimo_seq);
  v_sesion := public._cc_sesion_cerrar(p_conv, case when v_rol = 'admin' then 'direccion_finalizo' else 'asesor_finalizo' end, v_actor, p_profile);
  update public.cc_participants set left_at = now() where conversation_id = p_conv and rol = 'asesor' and left_at is null;
  update public.cc_conversations
     set modo = 'ai_active', seller_profile_id = null, ruteo_motivo = null, handoff_origen = null, handoff_cart_id = null, handoff_fuera_horario = null,
         asesoria_solicitada_at = null, asesoria_asignada_at = null, asesoria_iniciada_at = null, asesoria_terminada_at = null, updated_at = now()
   where id = p_conv;
  select ordinal into v_ord from public.cc_conversation_sessions where id = v_sesion;
  return jsonb_build_object('modo', 'ai_active', 'idempotente', false, 'sesion_id', v_sesion, 'sesion_ordinal', v_ord);
end;
$function$

;
