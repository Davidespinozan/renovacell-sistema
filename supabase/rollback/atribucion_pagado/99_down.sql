-- ATRIBUCIÓN Y PAGADO (20270203) · rollback: vuelve la atribución solo por cartera del portal, el cobro sin mover el
-- estado del pedido, el evaluador sin recordatorio de cola, las políticas anteriores y retira el aviso de pedido nuevo.
drop trigger if exists trg_aviso_pedido_nuevo on public.orders;
drop function if exists public._aviso_pedido_nuevo();
drop policy if exists order_items_select_scoped on public.order_items;
create policy order_items_select_scoped on public.order_items for select to authenticated using (
  (auth_role() = any (array['admin', 'warehouse', 'packing', 'billing']))
  or ((auth_role() = 'pos') and _sec_c1_ve_pedido(order_id))
  or (exists (select 1 from public.orders o where ((o.id = order_items.order_id) and (o.doctor_id = auth.uid())))));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
case
    when (user_ids is not null) then (auth.uid() = any (user_ids))
    else ((auth_role() <> 'doctor'::text) and ((app_role() = 'admin'::text) or (roles is null) or (app_role() = any (roles))))
end);

CREATE OR REPLACE FUNCTION public._cx0c_atribucion(p_customer uuid, p_doctor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_p uuid; v_odoo text; v_seller uuid; v_ok boolean; v_email text;
begin
  if p_customer is not null then
    select c.profile_id, nullif(btrim(c.seller_name), '') into v_p, v_odoo from public.customers c where c.id = p_customer;
    if v_p is null then   -- cuenta sin portal
      if v_odoo is not null or (p_doctor is not null and exists (select 1 from public.cc_cartera k where k.profile_id = p_doctor)) then
        return jsonb_build_object('estado', 'no_resoluble');
      end if;
      return jsonb_build_object('estado', 'sin_asignacion');
    end if;
  else
    v_p := p_doctor;
  end if;
  if v_p is null then return jsonb_build_object('estado', 'sin_asignacion'); end if;
  select k.seller_profile_id into v_seller from public.cc_cartera k where k.profile_id = v_p;
  if v_seller is null then
    return jsonb_build_object('estado', case when v_odoo is not null then 'no_resoluble' else 'sin_asignacion' end);
  end if;
  select coalesce(p.active, false) and p.role_id = 'pos', p.email into v_ok, v_email from public.profiles p where p.id = v_seller;
  if not coalesce(v_ok, false) then return jsonb_build_object('estado', 'no_resoluble'); end if;
  return jsonb_build_object('estado', 'cartera', 'seller_profile_id', v_seller, 'seller', v_email);
end;
$function$
;

CREATE OR REPLACE FUNCTION public._w2_recalc_payment_status(p_order uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_estado text;
begin
  select estado_pago into v_estado from public.v_order_money where order_id = p_order;
  if v_estado is null then return null; end if;
  perform public._w2_trusted(true);
  update public.orders set payment_status = v_estado where id = p_order and payment_status is distinct from v_estado;
  perform public._w2_trusted(false);
  return v_estado;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_atencion_evaluar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg record; hor jsonb; v_conf boolean; r record; n int := 0; n_aviso int := 0; n_esc int := 0; n_rep int := 0; n_agot int := 0; reloj integer; s uuid; v_motivo text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not (public._cc_es_admin() or public._cc_es_service()) then
    raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.cc_atencion_config where id = 1;
  hor := public._cc_horario_estado(now()); v_conf := coalesce((hor ->> 'configurado')::boolean, false);
  if cfg.pausar_fuera_horario and not v_conf then return jsonb_build_object('evaluadas', 0, 'avisos', 0, 'escalaciones', 0, 'repartos', 0, 'agotados', 0, 'omitido', 'horario_sin_configurar'); end if;
  for r in select c.id, c.seller_profile_id, c.asesoria_asignada_at, c.ruteo_motivo, c.profile_id, c.asesoria_solicitada_at from public.cc_conversations c
            where c.estado = 'abierta' and c.modo = 'human_assigned' and c.seller_profile_id is not null and c.asesoria_asignada_at is not null loop
    n := n + 1;
    reloj := case when cfg.pausar_fuera_horario then public._cc_minutos_habiles(r.asesoria_asignada_at, now()) else floor(extract(epoch from (now() - r.asesoria_asignada_at)) / 60)::int end;
    if reloj is null then continue; end if;
    if r.ruteo_motivo = 'reparto' then
      -- REPARTO · nadie la inició en el plazo: pasa al siguiente vendedor que no la haya tenido; agotados, a Dirección.
      if reloj >= cfg.reparto_min then
        s := public._cc_reparto_elegir(r.id);
        if s is not null then
          perform public._cc_reparto_asignar(r.id, s); n_rep := n_rep + 1;
        else
          v_motivo := case when r.profile_id is null then 'visitante' else 'sin_vendedor' end;
          perform public._cc_handler_asignar(r.id, null, 'system', null, 'reparto_agotado', 'reparto');
          update public.cc_conversations set ruteo_motivo = v_motivo, updated_at = now() where id = r.id;
          perform public._cc_evento(r.id, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', v_motivo, 'origen', 'reparto_agotado'));
          perform public._cc_notificar('handoff_sin_vendedor', r.id, null, array['admin'], 'Nadie tomó la solicitud repartida: ' || public._cc_nombre_dueno(r.id), 'av_atencion',
                  'sin_vendedor:' || r.id::text || ':' || coalesce(extract(epoch from r.asesoria_solicitada_at)::bigint::text, 'na') || ':agotado');
          n_agot := n_agot + 1;
        end if;
      end if;
      continue;
    end if;
    if reloj >= cfg.escalamiento_min then
      if public._cc_notificar('handoff_escalado', r.id, null, array['admin'],
           format('Solicitud sin atender %s min hábiles con %s: %s', reloj, public._cc_nombre_perfil(r.seller_profile_id), public._cc_nombre_dueno(r.id)), 'av_atencion',
           'escalacion:' || r.id::text || ':' || extract(epoch from r.asesoria_asignada_at)::bigint::text) = 'emitida' then n_esc := n_esc + 1; end if;
    elsif reloj >= cfg.aviso_min then   -- el recordatorio al vendedor solo ANTES de escalar: escalada, decide Dirección (sin ruido)
      if public._cc_notificar('handoff_aviso', r.id, array[r.seller_profile_id], null,
           format('Recordatorio: %s sigue esperando asesor (%s min)', public._cc_nombre_dueno(r.id), reloj), 'asesorias',
           'aviso:' || r.id::text || ':' || extract(epoch from r.asesoria_asignada_at)::bigint::text) = 'emitida' then n_aviso := n_aviso + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('evaluadas', n, 'avisos', n_aviso, 'escalaciones', n_esc, 'repartos', n_rep, 'agotados', n_agot);
end;
$function$
;

alter function public._cx0c_atribucion(uuid, uuid) owner to postgres;
alter function public._w2_recalc_payment_status(uuid) owner to postgres;
alter function public.cc_atencion_evaluar() owner to postgres;
