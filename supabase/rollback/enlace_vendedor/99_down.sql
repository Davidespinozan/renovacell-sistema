-- ENLACE-VENDEDOR (20270211) · down: ruteo, prerregistro y vendedor del doctor vuelven a su definición exacta anterior
-- (VINCULAR-CLIENTE / CX-ENLACE / AVISO-VERIF); fuera las funciones, columnas y tabla de enlaces. La bitácora de 'enlace'
-- del visitante se retira para restaurar su catálogo de tipos.
CREATE OR REPLACE FUNCTION public._cc_rutear(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c record; s uuid; v_motivo text; cfg record;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.modo <> 'human_requested' then
    return jsonb_build_object('asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'), 'sin_cambio', true);
  end if;
  if c.profile_id is null then
    -- Visitante: no hay cartera; solo un asesor que Dirección ya le haya puesto a ESTA conversación.
    if c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id) then s := c.seller_profile_id;
    -- VINCULAR-CLIENTE · el personal ya confirmó quién es: va al vendedor de SU cartera.
    elsif c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then s := public._cc_vendedor_de_cliente(c.customer_id);
    else
      -- CX-ENLACE · su prerregistro coincide con un cliente que tiene vendedor: va a ESE vendedor (posible cliente, sin confirmar).
      select r.posible_seller_id into s from public.cc_prerregistros r
       where r.visitor_id = c.visitor_id and r.posible_seller_id is not null and public._cc_vendedor_elegible(r.posible_seller_id, false);
      if s is null then v_motivo := 'visitante'; end if;
    end if;
  else
    s := public._cc_vendedor_de(c.profile_id);
    if s is null then v_motivo := 'sin_vendedor';
    elsif not public._cc_vendedor_elegible(s, false) then v_motivo := 'vendedor_no_elegible'; s := null;
    end if;
  end if;
  if v_motivo is null then
    if c.seller_profile_id is distinct from s then
      if c.seller_profile_id is not null then
        update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
        perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'cartera'));
      end if;
      update public.cc_conversations set seller_profile_id = s, updated_at = now() where id = p_conv;
      perform public._cc_participante(p_conv, 'seller', null, s, 'asesor');
    end if;
    update public.cc_conversations set ruteo_motivo = null where id = p_conv;
    perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', 'system', null, null, jsonb_build_object('seller', s, 'origen', case when c.profile_id is null then 'conversacion' else 'cartera' end));
    -- CHV2-A · alerta SOLO al vendedor asignado (D-CHV2-02). Idempotente por asignación; nunca revierte el ruteo.
    perform public._cc_notificar('handoff_asignado', p_conv, array[s], null, 'Solicitud de asesor: ' || public._cc_nombre_dueno(p_conv), 'asesorias',
            'asignacion:' || p_conv::text || ':' || s::text || ':' || extract(epoch from now())::bigint::text);
    return jsonb_build_object('asignado', true, 'seller', s);
  end if;
  -- Sin vendedor de cartera. Se libera un asesor que ya no puede atender.
  if c.seller_profile_id is not null then
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', v_motivo));
  end if;
  update public.cc_conversations set seller_profile_id = null, ruteo_motivo = v_motivo, updated_at = now() where id = p_conv;
  -- REPARTO (181) · al azar entre los vendedores elegibles para nuevos; si nadie la inicia, el evaluador la pasa a otro.
  select * into cfg from public.cc_atencion_config where id = 1;
  if cfg.reparto_activo then
    s := public._cc_reparto_elegir(p_conv);
    if s is not null then
      return public._cc_reparto_asignar(p_conv, s) || jsonb_build_object('asignado', true, 'seller', s, 'motivo_original', v_motivo);
    end if;
  end if;
  -- CHV2-A · sin vendedor elegible → Dirección (una vez por solicitud).
  perform public._cc_notificar('handoff_sin_vendedor', p_conv, null, array['admin'], 'Solicitud de asesor sin vendedor: ' || public._cc_nombre_dueno(p_conv), 'av_atencion',
          'sin_vendedor:' || p_conv::text || ':' || coalesce(extract(epoch from c.asesoria_solicitada_at)::bigint::text, 'na'));
  return jsonb_build_object('asignado', false, 'motivo', v_motivo);
end;
$function$
;

CREATE OR REPLACE FUNCTION public._vendedor_de_doctor(p_profile uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cc_visitante_prerregistrar(p_hash text, p_nombre text, p_telefono text, p_email text, p_es_medico boolean, p_cedula text, p_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '[[:space:]]+', ' ', 'g');
  v_tel text := public.norm_telefono_mx(p_telefono); v_email text := lower(btrim(coalesce(p_email, '')));
  v_ced text := nullif(btrim(coalesce(p_cedula, '')), ''); m jsonb; v_prospect uuid; v_seller uuid; r public.cc_prerregistros;
begin
  v_id := public._cc_visitor_por_hash(p_hash);
  if v_id is null then raise exception 'SESION_INVALIDA'; end if;
  perform 1 from public.cc_visitors where id = v_id for update;   -- un prerregistro a la vez por visitante
  select * into r from public.cc_prerregistros where visitor_id = v_id;
  if found then   -- el contacto no se cambia después: nadie se "re-rutea" tecleando los datos de otro
    return jsonb_build_object('estado', 'ya_registrado', 'visitor_id', v_id, 'nombre', r.nombre);
  end if;
  if coalesce(p_consent, false) is not true then raise exception 'PRERREGISTRO_INVALIDO: consentimiento'; end if;
  if length(v_nombre) < 3 or length(v_nombre) > 120 then raise exception 'PRERREGISTRO_INVALIDO: nombre'; end if;
  if v_tel is null or v_tel !~ '^[0-9]{10}$' then raise exception 'PRERREGISTRO_INVALIDO: telefono'; end if;
  if length(v_email) > 160 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'PRERREGISTRO_INVALIDO: email'; end if;
  if v_ced is not null and (length(v_ced) < 5 or length(v_ced) > 40) then raise exception 'PRERREGISTRO_INVALIDO: cedula'; end if;

  m := public._cc_prerregistro_coincidencia(v_email, v_tel);
  v_seller := (m ->> 'seller')::uuid;
  v_prospect := public.buscar_prospecto_duplicado(v_email, v_tel);
  if v_prospect is null then
    insert into public.prospects (name, email, phone, cedula, source, status, assigned_to, customer_id, meta)
    values (v_nombre, v_email, v_tel, v_ced, 'Enlace de contacto', 'nuevo', v_seller, (m ->> 'customer')::uuid,
            jsonb_build_object('capturedVia', 'enlace-contacto', 'es_medico', coalesce(p_es_medico, false), 'interest', '[]'::jsonb, 'notes', '[]'::jsonb,
                               'consentimiento', jsonb_build_object('privacidad', true, 'at', now())))
    returning id into v_prospect;
  end if;
  update public.prospects set visitor_id = v_id where id = v_prospect and visitor_id is null;
  insert into public.cc_prerregistros (visitor_id, nombre, telefono, email, es_medico, cedula, consent_at, prospect_id, posible_customer_id, posible_profile_id, posible_seller_id)
  values (v_id, v_nombre, v_tel, v_email, coalesce(p_es_medico, false), v_ced, now(), v_prospect, (m ->> 'customer')::uuid, (m ->> 'profile')::uuid, v_seller);
  insert into public.cc_visitor_events (visitor_id, tipo, detalle)
  values (v_id, 'prerregistro', jsonb_build_object('prospect_id', v_prospect, 'coincide_cliente', m ->> 'customer' is not null, 'con_vendedor', v_seller is not null));
  -- Aviso interno: al vendedor del posible cliente, o a Dirección para que asigne uno (una vez por visitante; nunca bloquea).
  perform public._cc_notificar('contacto_enlace', null,
    case when v_seller is not null then array[v_seller] end, case when v_seller is null then array['admin'] end,
    case when v_seller is not null then 'Un posible cliente tuyo escribió por el enlace de contacto: ' || v_nombre
         else 'Nuevo contacto por el enlace, sin vendedor: ' || v_nombre end,
    'av_prosp', 'prerregistro:' || v_id::text);
  return jsonb_build_object('estado', 'registrado', 'visitor_id', v_id, 'nombre', v_nombre);
end;
$function$
;

drop function public.cc_origen_conversacion(uuid);
drop function public.cc_enlaces_equipo();
drop function public.cc_mi_enlace();
drop function public.cc_visitante_enlace(text, text);
drop function public.cc_enlace_publico(text);
drop function public._cc_enlace_cifras(text);
drop function public._cc_enlace_de_cliente(uuid);
drop function public._cc_enlace_de_vendedor(uuid);
drop function public._cc_enlace(text);
drop function public._cc_slug(text);
delete from public.cc_visitor_events where tipo = 'enlace';
alter table public.cc_visitor_events drop constraint ck_ccve_tipo;
alter table public.cc_visitor_events add constraint ck_ccve_tipo
  check (tipo = any (array['abierto', 'last_touch', 'prospecto', 'registro', 'adoptado', 'conflicto', 'revocado', 'prerregistro']));
alter table public.cc_visitors drop column referido_por, drop column enlace_codigo;
drop table public.cc_enlaces;
