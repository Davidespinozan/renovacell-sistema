-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- REPARTO-VERIF (30 oct 2026). Dueño: "la verificación de doctores no se hará desde Dirección, lo harán los vendedores y eso
--   tiene que ser aleatorio; todo lo que sea verificación, atención, etc. es aleatorio a menos que el cliente ya tenga
--   asignado un vendedor". Decisiones: si no la resuelve en 4 h hábiles pasa al azar a otro; cuando ya pasó por todos,
--   NUEVA VUELTA entre vendedores (Dirección solo se entera).
--   · cc_verif_reparto: a qué vendedor le tocó verificar a un doctor sin vendedor, desde cuándo y quiénes ya lo tuvieron.
--   · verificacion_avisar: con vendedor (cartera, conversación, prerregistro, enlace) como antes; SIN vendedor → al azar
--     entre los vendedores elegibles (los mismos del reparto de conversaciones). La cartera se fija cuando ESE vendedor lo
--     verifica (doctor_verificar ya lo hace: 'Lo verificó su vendedor').
--   · _puede_verificar: además, el vendedor al que le tocó por reparto.
--   · cc_verif_reparto_evaluar (cron cada 5 min): pasa a otro tras 4 h hábiles (config verif_reparto_min) y limpia los ya
--     resueltos. Fuera de horario el reloj se pausa (_cc_minutos_habiles).
--   · Atención (cc_atencion_evaluar): reparto agotado → nueva vuelta en vez de Dirección.
--   · Prerregistro sin vendedor: ya no avisa a Dirección (su conversación entra al reparto al dejar sus datos).
--   · Los doctores que hoy esperan sin vendedor se reparten al aplicar.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_verif_reparto') is not null then raise exception 'REPARTO-VERIF: ya aplicada'; end if;
  if to_regprocedure('public.verificacion_avisar(uuid)') is null or to_regprocedure('public._puede_verificar(uuid)') is null
     or to_regprocedure('public.cc_atencion_evaluar()') is null or to_regprocedure('public._cc_minutos_habiles(timestamptz,timestamptz)') is null
     or to_regprocedure('public.cc_ia_registrar_contacto(uuid,text,text,text,text,boolean,text)') is null then
    raise exception 'REPARTO-VERIF: faltan AVISO-VERIF, REPARTO o CONTACTO-CONV (20270212)'; end if;
end $pre$;

alter table public.cc_atencion_config add column verif_reparto_min integer not null default 240
  constraint ck_cac_verif_reparto check (verif_reparto_min between 30 and 4320);
comment on column public.cc_atencion_config.verif_reparto_min is 'REPARTO-VERIF · minutos hábiles que tiene el vendedor al que le tocó verificar a un doctor antes de que pase a otro (4 h).';

create table public.cc_verif_reparto (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  seller_profile_id uuid not null references public.profiles(id) on delete cascade,
  asignado_at       timestamptz not null default now(),
  probados          uuid[] not null default '{}',
  vueltas           integer not null default 0,
  created_at        timestamptz not null default now()
);
alter table public.cc_verif_reparto enable row level security;   -- sin políticas: solo funciones
revoke all on public.cc_verif_reparto from anon, authenticated;

-- ¿Sigue pendiente su verificación? (el mismo criterio de "Por verificar")
create function public._doctor_verif_pendiente(p uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles x where x.id = p and x.role_id = 'doctor' and not x.verified and coalesce(x.meta -> 'verification' ->> 'status', 'pending') = 'pending') $$;

-- Un vendedor al azar de los que reciben clientes nuevos (los del reparto de conversaciones), fuera de los excluidos.
create function public._cc_vendedor_azar(p_excluir uuid[] default '{}') returns uuid language sql volatile security definer set search_path = public as
$$
  select p.id from public.profiles p
   where p.role_id = 'pos' and not coalesce(p.interna, false) and public._cc_vendedor_elegible(p.id, true) and not (p.id = any (coalesce(p_excluir, '{}')))
   order by random() limit 1
$$;

-- Le toca a otro vendedor al azar (sin repetir en la vuelta; agotados, nueva vuelta). null = no hay ningún vendedor.
create function public._verif_reparto_asignar(p_profile uuid) returns uuid language plpgsql security definer set search_path = public as
$$
declare v public.cc_verif_reparto; s uuid; v_nombre text;
begin
  select * into v from public.cc_verif_reparto where profile_id = p_profile for update;
  s := public._cc_vendedor_azar(coalesce(v.probados, '{}'));
  if s is null and v.profile_id is not null then   -- ya pasó por todos: nueva vuelta (sin repetir al último si hay otro)
    s := coalesce(public._cc_vendedor_azar(array[v.seller_profile_id]), public._cc_vendedor_azar('{}'));
    if s is not null then update public.cc_verif_reparto set probados = '{}', vueltas = vueltas + 1 where profile_id = p_profile; end if;
  end if;
  select coalesce(nullif(btrim(full_name), ''), meta ->> 'name', 'Un doctor') into v_nombre from public.profiles where id = p_profile;
  if s is null then
    perform public._cc_notificar('verificacion_por_revisar', null, null, array['admin'], v_nombre || ' espera verificación y no hay vendedores que reciban clientes nuevos', 'av_verif',
      'verif_sin_vendedores:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
    return null;
  end if;
  insert into public.cc_verif_reparto (profile_id, seller_profile_id, asignado_at, probados) values (p_profile, s, now(), array[s])
  on conflict (profile_id) do update set seller_profile_id = s, asignado_at = now(), probados = array_append(public.cc_verif_reparto.probados, s);
  perform public._cc_notificar('verificacion_por_revisar', null, array[s], null,
    'Te tocó verificar a ' || v_nombre || ': revisa su cédula y su INE y apruébalo', 'clientes',
    'verif_reparto:' || p_profile::text || ':' || s::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  return s;
end;
$$;

create or replace function public.verificacion_avisar(p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare p record; v_seller uuid; v_nombre text; v_asignado boolean := false; v_reparto boolean := false;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select id, full_name, verified, meta into p from public.profiles where id = p_profile and role_id = 'doctor';
  if not found or p.verified then return jsonb_build_object('avisado', false); end if;
  v_nombre := coalesce(nullif(btrim(p.full_name), ''), p.meta ->> 'name', 'Un doctor');
  v_seller := public._vendedor_de_doctor(p_profile);
  if v_seller is not null and public._rol_de_perfil(v_seller) = 'admin' then v_seller := null; end if;   -- Dirección ya no verifica
  if v_seller is not null and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_profile, v_seller, now(), null, 'Atendió su registro');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_profile, null, v_seller, null, 'Atendió su registro');
    v_asignado := true;
  end if;
  if v_seller is not null then
    -- Una clave por minuto: si corrige y vuelve a mandar, vuelve a avisar; un doble envío no duplica.
    perform public._cc_notificar('verificacion_por_revisar', null, array[v_seller], null,
      v_nombre || ' mandó su verificación: revisa su cédula y su INE y apruébalo', 'clientes',
      'verif_aviso:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  else
    -- REPARTO-VERIF · sin vendedor: al azar. Si ya le había tocado a alguien (corrigió y reenvió), sigue con esa persona.
    select seller_profile_id into v_seller from public.cc_verif_reparto where profile_id = p_profile and public._cc_vendedor_elegible(seller_profile_id, true);
    if v_seller is not null then
      perform public._cc_notificar('verificacion_por_revisar', null, array[v_seller], null,
        v_nombre || ' volvió a mandar su verificación: revisa su cédula y su INE', 'clientes',
        'verif_aviso:' || p_profile::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    else
      v_seller := public._verif_reparto_asignar(p_profile);
    end if;
    v_reparto := v_seller is not null;
  end if;
  return jsonb_build_object('avisado', true, 'seller', v_seller, 'asignado', v_asignado, 'reparto', v_reparto, 'nombre', v_nombre);
end;
$$;

-- Rol de un perfil (para no tratar a Dirección como "el vendedor" del doctor).
create function public._rol_de_perfil(p uuid) returns text language sql stable security definer set search_path = public as
$$ select role_id from public.profiles where id = p $$;

create or replace function public._puede_verificar(p_profile uuid) returns boolean
  language sql stable security definer set search_path = public as
$$
  select p_profile is not null and auth.uid() is not null and (
    public.auth_role() = 'admin'
    or (public.auth_role() = 'pos' and public._cc_puede_atender(auth.uid()) and (
          exists (select 1 from public.cc_cartera k where k.profile_id = p_profile and k.seller_profile_id = auth.uid())
          or exists (select 1 from public.cc_conversations c where c.profile_id = p_profile and c.estado = 'abierta' and c.seller_profile_id = auth.uid())
          -- REPARTO-VERIF · le tocó por reparto
          or exists (select 1 from public.cc_verif_reparto v where v.profile_id = p_profile and v.seller_profile_id = auth.uid()))))
$$;

-- Cron: pasa a otro tras 4 h hábiles; limpia los ya resueltos (verificado, rechazado o con vendedor de cartera).
create function public.cc_verif_reparto_evaluar() returns jsonb language plpgsql security definer set search_path = public as
$$
declare cfg record; r record; n_rot int := 0; n_fin int := 0; reloj int;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not (public._cc_es_admin() or public._cc_es_service()) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.cc_atencion_config where id = 1;
  for r in select * from public.cc_verif_reparto for update skip locked loop
    if not public._doctor_verif_pendiente(r.profile_id) then delete from public.cc_verif_reparto where profile_id = r.profile_id; n_fin := n_fin + 1; continue; end if;
    reloj := case when cfg.pausar_fuera_horario then public._cc_minutos_habiles(r.asignado_at, now()) else floor(extract(epoch from (now() - r.asignado_at)) / 60)::int end;
    if reloj is not null and reloj >= cfg.verif_reparto_min then
      if public._verif_reparto_asignar(r.profile_id) is not null then n_rot := n_rot + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('rotados', n_rot, 'resueltos', n_fin);
end;
$$;

revoke all on function public._doctor_verif_pendiente(uuid), public._cc_vendedor_azar(uuid[]), public._verif_reparto_asignar(uuid), public._rol_de_perfil(uuid) from public, anon, authenticated;
revoke all on function public.cc_verif_reparto_evaluar() from public, anon;
grant execute on function public.cc_verif_reparto_evaluar() to service_role;
grant execute on function public._cc_vendedor_azar(uuid[]) to service_role;   -- la Edge capture-lead reparte el lead del sitio

-- ── Atención: reparto agotado → nueva vuelta ──────────────────────────────────────────────────────
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
      -- REPARTO · nadie la inició en el plazo: pasa al siguiente vendedor que no la haya tenido; agotados, nueva vuelta.
      if reloj >= cfg.reparto_min then
        s := public._cc_reparto_elegir(r.id);
        if s is not null then
          perform public._cc_reparto_asignar(r.id, s); n_rep := n_rep + 1;
        else
          -- REPARTO-VERIF (dueño, 30 oct) · nadie la tomó en la vuelta: NUEVA VUELTA entre vendedores (sin repetir al último
          -- si hay otro); Dirección solo se entera. A Dirección solo llega si no queda ningún vendedor elegible.
          update public.cc_conversations set reparto_probados = case when r.seller_profile_id is null then '{}'::uuid[] else array[r.seller_profile_id] end where id = r.id;
          s := public._cc_reparto_elegir(r.id);
          if s is null and r.seller_profile_id is not null and public._cc_vendedor_elegible(r.seller_profile_id, true) then
            update public.cc_conversations set reparto_probados = '{}'::uuid[] where id = r.id; s := r.seller_profile_id;
          end if;
          if s is not null then
            perform public._cc_reparto_asignar(r.id, s);
            update public.cc_conversations set asesoria_asignada_at = now() where id = r.id;   -- reloj nuevo para esta vuelta
            perform public._cc_notificar('handoff_escalado', r.id, null, array['admin'], 'Nadie tomó la solicitud en su vuelta; se repartió de nuevo: ' || public._cc_nombre_dueno(r.id), 'av_atencion',
                    'nueva_vuelta:' || r.id::text || ':' || coalesce(extract(epoch from r.asesoria_solicitada_at)::bigint::text, 'na'));
            n_rep := n_rep + 1; continue;
          end if;
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

-- ── Prerregistro: sin vendedor ya no avisa a Dirección ────────────────────────────────────────────
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
  -- Aviso interno: al vendedor del posible cliente; si no, al del enlace (una vez por visitante). Sin vendedor no se avisa
  -- a Dirección (REPARTO-VERIF): su conversación entra al reparto al azar en cuanto deja sus datos.
  if coalesce(v_seller, v_ref) is not null then
  perform public._cc_notificar('contacto_enlace', null, array[coalesce(v_seller, v_ref)], null,
    case when v_seller is not null then 'Un posible cliente tuyo escribió por el enlace de contacto: ' || v_nombre
         when v_refiere is not null then 'Te recomendaron: ' || v_nombre || ' (de parte de ' || coalesce(public._cc_primer_nombre((select full_name from public.customers where id = v_refiere)), 'un cliente') || ')'
         when v_ref is not null then 'Nuevo contacto por tu enlace: ' || v_nombre
         else null end,
    'av_prosp', 'prerregistro:' || v_id::text);
  end if;
  if v_seller is not null and v_ref is not null and v_seller <> v_ref then
    perform public._cc_notificar('contacto_enlace', null, array[v_ref], null,
      'Un contacto de tu enlace ya es cliente de ' || coalesce(public._cc_nombre_personal(v_seller), 'otro vendedor') || ': la conversación le llega a esa persona.',
      'asesorias', 'enlace_conflicto:' || v_id::text);
  end if;
  return jsonb_build_object('estado', 'registrado', 'visitor_id', v_id, 'nombre', v_nombre);
end;
$function$;

-- ── Cron (por nombre exacto) ───────────────────────────────────────────────────────────────────────
do $cron$
declare r record;
begin
  for r in select jobid from cron.job where jobname = 'renovacell-verif-reparto' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('renovacell-verif-reparto'::text, '*/5 * * * *'::text, 'select public.cc_verif_reparto_evaluar();'::text);
end $cron$;

-- ── Los doctores que hoy esperan sin vendedor se reparten ya ─────────────────────────────────────
do $hoy$
declare d record;
begin
  for d in select p.id from public.profiles p
            where public._doctor_verif_pendiente(p.id)
              and (public._vendedor_de_doctor(p.id) is null or public._rol_de_perfil(public._vendedor_de_doctor(p.id)) = 'admin')
              and not exists (select 1 from public.cc_verif_reparto v where v.profile_id = p.id) loop
    perform public._verif_reparto_asignar(d.id);
  end loop;
end $hoy$;

do $post$ begin
  if to_regclass('public.cc_verif_reparto') is null or to_regprocedure('public.cc_verif_reparto_evaluar()') is null
     or (select count(*) from cron.job where jobname = 'renovacell-verif-reparto' and active) <> 1 then
    raise exception 'REPARTO-VERIF: no quedó aplicada'; end if;
end $post$;
