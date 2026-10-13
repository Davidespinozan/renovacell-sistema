-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CX-ENLACE (migración 150) · ENLACE ÚNICO DE CONTACTO CON PRERREGISTRO
--   Decisión del dueño (13 oct 2026): el mismo chat del sistema se abre desde UN enlace que se comparte en grupos.
--   Para conversar no hace falta estar verificado, pero sí dejar datos mínimos (nombre, celular, correo y aceptar
--   el aviso de privacidad). Quien coincide con un cliente que tiene vendedor llega a ESE vendedor; los demás, a la
--   cola de Dirección. Al registrarse y entrar al sistema, la conversación y su historial siguen (adopción CC-1/CC-2).
--   · cc_prerregistros                 NUEVA. Un prerregistro por visitante. Sin políticas: solo comandos.
--   · cc_visitante_prerregistrar       NUEVA (servicio). Guarda el contacto, crea o reutiliza el prospecto y calcula
--                                      la coincidencia con clientes. Idempotente: el contacto no se cambia después.
--   · cc_puerta_chat                   NUEVA (servicio). ¿Este visitante o esta cuenta sin verificar puede conversar?
--   · cc_contacto_de                   NUEVA (Dirección o el asesor asignado). Datos del prerregistro de una conversación.
--   · _cc_rutear                       un cambio: el visitante prerregistrado que coincide va al vendedor de ese cliente.
--   · _cc_nombre_dueno, cc_cola_asesorias   un cambio: muestran el nombre del prerregistro en vez de "Visitante".
--   SEGURIDAD: teclear el correo o el celular de un cliente NO prueba identidad. La coincidencia solo sirve para
--   RUTEAR; no adopta, no fusiona y no da acceso a historial, precios ni pedidos (eso exige iniciar sesión).
--   Aplicar en UNA transacción. Rollback: supabase/rollback/cx_enlace/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_prerregistros') is not null then raise exception 'CX-ENLACE: ya aplicada'; end if;
  if md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) <> '4f79575dced5024a14cee0eec3d3d109'
     or md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> 'd031a799c72205e532381a3f4a1ec200'
     or md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) <> '1a761f28d2137357498534b0524e2039' then
    raise exception 'CX-ENLACE: _cc_rutear / _cc_nombre_dueno / cc_cola_asesorias no son las versiones auditadas';
  end if;
  if to_regclass('public.cc_cartera_historica_equivalencias') is null or to_regprocedure('public.buscar_prospecto_duplicado(text,text)') is null
     or to_regprocedure('public.norm_telefono_mx(text)') is null then
    raise exception 'CX-ENLACE: faltan piezas previas (cartera histórica, prospectos, teléfono)';
  end if;
end $pre$;

create table public.cc_prerregistros (
  visitor_id          uuid primary key references public.cc_visitors(id) on delete cascade,
  nombre              text not null check (length(btrim(nombre)) between 3 and 120),
  telefono            text not null check (telefono ~ '^[0-9]{10}$'),
  email               text not null check (email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' and length(email) <= 160),
  es_medico           boolean not null default false,
  cedula              text check (cedula is null or length(cedula) between 5 and 40),
  consent_at          timestamptz not null,
  prospect_id         uuid references public.prospects(id) on delete set null,
  posible_customer_id uuid references public.customers(id) on delete set null,
  posible_profile_id  uuid references public.profiles(id) on delete set null,
  posible_seller_id   uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);
comment on table public.cc_prerregistros is 'CX-ENLACE · datos mínimos que deja quien entra al chat por el enlace de contacto. La coincidencia con un cliente es solo para rutear: no prueba identidad.';
create index ix_cc_prerregistros_email on public.cc_prerregistros (email);
create index ix_cc_prerregistros_telefono on public.cc_prerregistros (telefono);
alter table public.cc_prerregistros enable row level security;   -- sin políticas: se lee y escribe solo por comandos
revoke all on table public.cc_prerregistros from public, anon, authenticated;
grant select, insert, update, delete on table public.cc_prerregistros to service_role;

alter table public.cc_visitor_events drop constraint ck_ccve_tipo;
alter table public.cc_visitor_events add constraint ck_ccve_tipo
  check (tipo = any (array['abierto', 'last_touch', 'prospecto', 'registro', 'adoptado', 'conflicto', 'revocado', 'prerregistro']));

create function public._cc_prerregistro_coincidencia(p_email text, p_telefono text) returns jsonb
  language plpgsql stable set search_path = public as
$$
-- ¿El correo o el celular coinciden con un cliente conocido? Solo se afirma cuando NO hay ambigüedad: un único
-- cliente y un único vendedor elegible (cartera canónica o equivalencia histórica). Con dudas, decide Dirección.
declare v_cust uuid[]; v_prof uuid[]; v_sell uuid[];
begin
  select array_agg(distinct cu.id) into v_cust from public.customers cu
   where cu.active and ((cu.email is not null and lower(btrim(cu.email)) = p_email) or public.norm_telefono_mx(cu.phone) = p_telefono);
  select array_agg(distinct x.id) into v_prof from (
    select cu.profile_id as id from public.customers cu where cu.id = any (coalesce(v_cust, '{}')) and cu.profile_id is not null
    union
    select p.id from public.profiles p where p.role_id = 'doctor' and p.active and p.email is not null and lower(btrim(p.email)) = p_email) x;
  select array_agg(distinct y.s) into v_sell from (
    select public._cc_vendedor_de(pid) as s from unnest(coalesce(v_prof, '{}')) pid
    union
    select e.seller_profile_id from public.customers cu
      join public.cc_cartera_historica_equivalencias e on e.seller_name_odoo = cu.seller_name
     where cu.id = any (coalesce(v_cust, '{}'))) y
   where y.s is not null and public._cc_vendedor_elegible(y.s, false);
  return jsonb_build_object(
    'customer', case when cardinality(v_cust) = 1 then v_cust[1] end,
    'profile',  case when cardinality(v_prof) = 1 then v_prof[1] end,
    'seller',   case when cardinality(v_sell) = 1 then v_sell[1] end);
end;
$$;

create function public.cc_visitante_prerregistrar(p_hash text, p_nombre text, p_telefono text, p_email text, p_es_medico boolean, p_cedula text, p_consent boolean)
  returns jsonb language plpgsql security definer set search_path = public as
$$
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
$$;

create function public.cc_puerta_chat(p_hash text, p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
-- ¿Puede conversar quien no es una cuenta con acceso? Un visitante, solo con prerregistro. Un doctor sin verificar,
-- solo si su cuenta viene de un prerregistro (adoptado o vinculado por su registro): no pierde la conversación.
declare v_id uuid; r record;
begin
  if p_profile is not null then
    select pr.nombre into r from public.cc_prerregistros pr join public.cc_visitors v on v.id = pr.visitor_id
     where v.adopted_profile_id = p_profile or (v.pending_profile_id = p_profile and v.estado = 'activo') limit 1;
    return jsonb_build_object('visitante', false, 'prerregistrado', found, 'nombre', case when found then r.nombre end);
  end if;
  v_id := public._cc_visitor_por_hash(p_hash);
  if v_id is null then return jsonb_build_object('visitante', false, 'prerregistrado', false, 'nombre', null); end if;
  select pr.nombre into r from public.cc_prerregistros pr where pr.visitor_id = v_id;
  return jsonb_build_object('visitante', true, 'prerregistrado', found, 'nombre', case when found then r.nombre end);
end;
$$;

create function public.cc_contacto_de(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
-- Datos de contacto que dejó quien escribe por el enlace. Solo Dirección o el asesor asignado a ESA conversación.
declare c record; r public.cc_prerregistros;
begin
  select id, visitor_id, profile_id, seller_profile_id into c from public.cc_conversations where id = p_conv;
  if not found or not (public.auth_role() = 'admin' or (c.seller_profile_id is not null and c.seller_profile_id = auth.uid() and public._cc_puede_atender(auth.uid()))) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  if c.visitor_id is null then return null; end if;
  select * into r from public.cc_prerregistros where visitor_id = c.visitor_id;
  if not found then return null; end if;
  return jsonb_build_object('nombre', r.nombre, 'telefono', r.telefono, 'email', r.email, 'es_medico', r.es_medico, 'cedula', r.cedula,
    'posible_cliente', (select cu.full_name from public.customers cu where cu.id = r.posible_customer_id),
    'confirmado', c.profile_id is not null, 'desde', r.created_at);
end;
$$;

alter function public._cc_prerregistro_coincidencia(text, text) owner to postgres;
alter function public.cc_visitante_prerregistrar(text, text, text, text, boolean, text, boolean) owner to postgres;
alter function public.cc_puerta_chat(text, uuid) owner to postgres;
alter function public.cc_contacto_de(uuid) owner to postgres;
revoke all on function public._cc_prerregistro_coincidencia(text, text) from public, anon, authenticated;
revoke all on function public.cc_visitante_prerregistrar(text, text, text, text, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.cc_puerta_chat(text, uuid) from public, anon, authenticated;
revoke all on function public.cc_contacto_de(uuid) from public, anon;
grant execute on function public._cc_prerregistro_coincidencia(text, text) to service_role;
grant execute on function public.cc_visitante_prerregistrar(text, text, text, text, boolean, text, boolean) to service_role;
grant execute on function public.cc_puerta_chat(text, uuid) to service_role;
grant execute on function public.cc_contacto_de(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public._cc_rutear(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c record; s uuid; v_motivo text;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.modo <> 'human_requested' then
    return jsonb_build_object('asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'), 'sin_cambio', true);
  end if;
  if c.profile_id is null then
    -- Visitante: no hay cartera; solo un asesor que Dirección ya le haya puesto a ESTA conversación.
    if c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id) then s := c.seller_profile_id;
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
  -- Sin vendedor elegible: NUNCA se reasigna al azar. Se libera un asesor que ya no puede atender y se encola para Dirección.
  if c.seller_profile_id is not null then
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', v_motivo));
  end if;
  update public.cc_conversations set seller_profile_id = null, ruteo_motivo = v_motivo, updated_at = now() where id = p_conv;
  -- CHV2-A · sin vendedor elegible → Dirección (una vez por solicitud; D-CHV2-05: no hay pool de vendedores).
  perform public._cc_notificar('handoff_sin_vendedor', p_conv, null, array['admin'], 'Solicitud de asesor sin vendedor: ' || public._cc_nombre_dueno(p_conv), 'av_atencion',
          'sin_vendedor:' || p_conv::text || ':' || coalesce(extract(epoch from c.asesoria_solicitada_at)::bigint::text, 'na'));
  return jsonb_build_object('asignado', false, 'motivo', v_motivo);
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), 'Visitante') end
     from public.cc_conversations c where c.id = p_conv $function$;

CREATE OR REPLACE FUNCTION public.cc_cola_asesorias()
 RETURNS TABLE(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamp with time zone, last_message_at timestamp with time zone, es_mia boolean, sin_leer bigint, dueno text, handoff_origen text, fuera_horario boolean, ruteo_motivo text, cart_id uuid, n_items integer, edad_min integer, iniciada boolean, atencion jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), 'Visitante') end as dueno,
         c.handoff_origen, c.handoff_fuera_horario, c.ruteo_motivo,
         k.id, (select count(*)::int from public.cc_cart_items i where i.cart_id = k.id),
         case when c.asesoria_solicitada_at is null then null else (extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end,
         c.modo = 'human_active',
         public._cc_atencion(c.id)
    from public.cc_conversations c
    left join lateral (select kk.id from public.cc_carts kk where kk.estado = 'active'
                         and (case when c.profile_id is not null then kk.profile_id = c.profile_id else kk.visitor_id = c.visitor_id and kk.profile_id is null end) limit 1) k on true
   where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended')
     and public._cc_puede_atender(auth.uid())
     and (public.auth_role() = 'admin' or c.seller_profile_id = auth.uid())
   order by case when c.seller_profile_id = auth.uid() then 0 else 1 end, c.asesoria_solicitada_at nulls last
$function$;

do $post$ begin
  if md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) <> 'aee657ea83e0cbff9ce673b3fd6ef25e'
     or md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> '1ebaa87f1e9a1072df6d1eb16b3a0c92'
     or md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) <> '6c82ab2d546e3f7cc22b117a0589e7e7' then
    raise exception 'CX-ENLACE: las funciones no quedaron con la definición esperada';
  end if;
  if has_function_privilege('anon', 'public.cc_visitante_prerregistrar(text,text,text,text,boolean,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.cc_visitante_prerregistrar(text,text,text,text,boolean,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.cc_puerta_chat(text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.cc_contacto_de(uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.cc_prerregistros', 'select') or has_table_privilege('anon', 'public.cc_prerregistros', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.cc_prerregistros'::regclass) then
    raise exception 'CX-ENLACE: permisos inesperados';
  end if;
  if (select proacl::text from pg_proc where oid = 'public._cc_rutear(uuid)'::regprocedure) is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
    raise exception 'CX-ENLACE: los permisos de _cc_rutear cambiaron';
  end if;
end $post$;
