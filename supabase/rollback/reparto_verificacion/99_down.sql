-- REPARTO-VERIF (20270213) · down: verificación, permiso de verificar, evaluador de atención y prerregistro vuelven EXACTOS a
-- su definición anterior (producción); fuera el reparto de verificaciones, su cron y su configuración.
do $c$ declare r record; begin for r in select jobid from cron.job where jobname = 'renovacell-verif-reparto' loop perform cron.unschedule(r.jobid); end loop; end $c$;
CREATE OR REPLACE FUNCTION public.verificacion_avisar(p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._puede_verificar(p_profile uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_profile is not null and auth.uid() is not null and (
    public.auth_role() = 'admin'
    or (public.auth_role() = 'pos' and public._cc_puede_atender(auth.uid()) and (
          exists (select 1 from public.cc_cartera k where k.profile_id = p_profile and k.seller_profile_id = auth.uid())
          or exists (select 1 from public.cc_conversations c where c.profile_id = p_profile and c.estado = 'abierta' and c.seller_profile_id = auth.uid()))))
$function$;

CREATE OR REPLACE FUNCTION public.cc_atencion_evaluar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg record; hor jsonb; v_conf boolean; r record; n int := 0; n_aviso int := 0; n_esc int := 0; n_rep int := 0; n_agot int := 0; n_cola int := 0; reloj integer; s uuid; v_motivo text;
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
  -- EN COLA SIN VENDEDOR (reparto agotado o sin vendedores): Dirección recibe un recordatorio por cada tramo de
  -- escalamiento_min mientras nadie la tome; antes era un solo aviso y la solicitud se vencía sin respuesta.
  for r in select c.id, c.asesoria_solicitada_at from public.cc_conversations c
            where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null and c.asesoria_solicitada_at is not null loop
    reloj := case when cfg.pausar_fuera_horario then public._cc_minutos_habiles(r.asesoria_solicitada_at, now()) else floor(extract(epoch from (now() - r.asesoria_solicitada_at)) / 60)::int end;
    if reloj is null or reloj < greatest(cfg.escalamiento_min, 1) then continue; end if;
    if public._cc_notificar('handoff_escalado', r.id, null, array['admin'],
         format('Sigue esperando asesor (%s min hábiles, sin vendedor): %s', reloj, public._cc_nombre_dueno(r.id)), 'av_atencion',
         'cola:' || r.id::text || ':' || extract(epoch from r.asesoria_solicitada_at)::bigint::text || ':' || (reloj / greatest(cfg.escalamiento_min, 1))::text) = 'emitida' then n_cola := n_cola + 1; end if;
  end loop;
  return jsonb_build_object('evaluadas', n, 'avisos', n_aviso, 'escalaciones', n_esc, 'repartos', n_rep, 'agotados', n_agot, 'en_cola', n_cola);
end;
$function$;

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
  v_ref uuid; v_refiere uuid;
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
  -- ENLACE-VENDEDOR · quién lo trajo (y quién lo recomendó). La cartera gana; el enlace va después.
  select case when v.enlace_codigo is not null and public._cc_vendedor_elegible(v.seller_profile_id, false) then v.seller_profile_id end, v.referido_por
    into v_ref, v_refiere from public.cc_visitors v where v.id = v_id;
  v_prospect := public.buscar_prospecto_duplicado(v_email, v_tel);
  if v_prospect is null then
    insert into public.prospects (name, email, phone, cedula, source, status, assigned_to, customer_id, meta)
    values (v_nombre, v_email, v_tel, v_ced, case when v_refiere is not null then 'Recomendación' when v_ref is not null then 'Enlace del vendedor' else 'Enlace de contacto' end,
            'nuevo', coalesce(v_seller, v_ref), (m ->> 'customer')::uuid,
            jsonb_build_object('capturedVia', 'enlace-contacto', 'es_medico', coalesce(p_es_medico, false), 'interest', '[]'::jsonb, 'notes', '[]'::jsonb,
                               'consentimiento', jsonb_build_object('privacidad', true, 'at', now()),
                               'enlace', (select enlace_codigo from public.cc_visitors where id = v_id), 'referido_por', v_refiere))
    returning id into v_prospect;
  end if;
  update public.prospects set visitor_id = v_id where id = v_prospect and visitor_id is null;
  insert into public.cc_prerregistros (visitor_id, nombre, telefono, email, es_medico, cedula, consent_at, prospect_id, posible_customer_id, posible_profile_id, posible_seller_id)
  values (v_id, v_nombre, v_tel, v_email, coalesce(p_es_medico, false), v_ced, now(), v_prospect, (m ->> 'customer')::uuid, (m ->> 'profile')::uuid, v_seller);
  insert into public.cc_visitor_events (visitor_id, tipo, detalle)
  values (v_id, 'prerregistro', jsonb_build_object('prospect_id', v_prospect, 'coincide_cliente', m ->> 'customer' is not null, 'con_vendedor', v_seller is not null, 'enlace', v_ref is not null));
  -- Aviso interno: al vendedor del posible cliente; si no, al del enlace; si no, a Dirección (una vez por visitante).
  perform public._cc_notificar('contacto_enlace', null,
    case when coalesce(v_seller, v_ref) is not null then array[coalesce(v_seller, v_ref)] end, case when coalesce(v_seller, v_ref) is null then array['admin'] end,
    case when v_seller is not null then 'Un posible cliente tuyo escribió por el enlace de contacto: ' || v_nombre
         when v_refiere is not null then 'Te recomendaron: ' || v_nombre || ' (de parte de ' || coalesce(public._cc_primer_nombre((select full_name from public.customers where id = v_refiere)), 'un cliente') || ')'
         when v_ref is not null then 'Nuevo contacto por tu enlace: ' || v_nombre
         else 'Nuevo contacto por el enlace, sin vendedor: ' || v_nombre end,
    'av_prosp', 'prerregistro:' || v_id::text);
  if v_seller is not null and v_ref is not null and v_seller <> v_ref then
    perform public._cc_notificar('contacto_enlace', null, array[v_ref], null,
      'Un contacto de tu enlace ya es cliente de ' || coalesce(public._cc_nombre_personal(v_seller), 'otro vendedor') || ': la conversación le llega a esa persona.',
      'asesorias', 'enlace_conflicto:' || v_id::text);
  end if;
  return jsonb_build_object('estado', 'registrado', 'visitor_id', v_id, 'nombre', v_nombre);
end;
$function$;

drop function public.cc_verif_reparto_evaluar();
drop function public._verif_reparto_asignar(uuid);
drop function public._cc_vendedor_azar(uuid[]);
drop function public._doctor_verif_pendiente(uuid);
drop function public._rol_de_perfil(uuid);
drop table public.cc_verif_reparto;
alter table public.cc_atencion_config drop column verif_reparto_min;
