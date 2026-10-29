-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- VINCULAR-CLIENTE (29 oct 2026) · bloque 1 del expediente del vendedor.
--   Dueño: "que el vendedor pueda vincular a los clientes, reconocerlos…". Caso real: una clienta de Odoo escribió por
--   WhatsApp desde un número distinto al de su ficha; nadie la reconoció y nadie la atendió.
--   · cc_conversations.customer_id: el personal confirma QUIÉN es (ficha de cliente) en una conversación sin cuenta
--     (WhatsApp, Instagram/Messenger, enlace). No da a quien escribe ningún privilegio de cuenta (precios, pedidos): la
--     identidad por teléfono sigue fallando cerrado para la IA; esto es solo el expediente del personal.
--   · cc_cliente_sugerencias: candidatos por teléfono, correo y nombre escrito en el chat (nombre visible + teléfono
--     enmascarado, como el buscador de Ventas).
--   · cc_vincular_cliente: liga, guarda el número en la ficha (próxima vez se reconoce sola) y manda la conversación al
--     vendedor de SU cartera; si el cliente no tenía vendedor y vincula un vendedor, ese vendedor la toma (como el reparto).
--     Vincular a un cliente de otro vendedor NO da acceso a su expediente: la conversación pasa a su vendedor.
--   · cc_cliente_de_conversacion: la ficha corta para el panel del chat (completa solo para Dirección o su vendedor).
--   · Ruteo, nombre del dueño, Bandeja y cola usan el cliente vinculado.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) <> 'f1c1f37e170e4336fc231cac6077f061'
     or md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> '666cd0f65aa762aaa2c41fcdcdf0680d'
     or md5(pg_get_functiondef('public.cc_bandeja_unificada(integer)'::regprocedure)) <> 'b64ca70badff52647348f163c50bbcab'
     or md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) <> '6c82ab2d546e3f7cc22b117a0589e7e7' then
    raise exception 'VINCULAR-CLIENTE: ruteo/nombre/bandeja/cola cambiaron desde la auditoría; revisar antes de aplicar'; end if;
end $pre$;

-- ── 1) Vínculo conversación → ficha, con historial ───────────────────────────────────────────────────
alter table public.cc_conversations add column customer_id uuid references public.customers(id) on delete set null;
comment on column public.cc_conversations.customer_id is 'VINCULAR-CLIENTE · ficha de cliente que el personal confirmó para esta conversación (sin cuenta). Con cuenta, la ficha sale de customers.profile_id.';
create index ix_ccc_customer on public.cc_conversations (customer_id) where customer_id is not null;

create table public.cc_conversacion_cliente_hist (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.cc_conversations(id) on delete cascade,
  customer_anterior uuid, customer_nuevo uuid,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  detalle          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index ix_ccch_conv on public.cc_conversacion_cliente_hist (conversation_id, created_at desc);
alter table public.cc_conversacion_cliente_hist enable row level security;   -- sin políticas: solo comandos
revoke all on table public.cc_conversacion_cliente_hist from public, anon, authenticated;
grant select, insert on table public.cc_conversacion_cliente_hist to service_role;

-- ── 2) Utilidades ─────────────────────────────────────────────────────────────────────────────────────
-- Texto comparable: sin acentos (también MAYÚSCULAS acentuadas: lower() no las baja con configuración "C"), minúsculas,
-- solo letras y espacios.
create function public._cc_txt_norm(p text) returns text
  language sql immutable set search_path = public as
$$ select btrim(regexp_replace(lower(translate(coalesce(p, ''), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc')), '[^a-z]+', ' ', 'g')) $$;

-- Vendedor de cartera de una ficha: con cuenta, cc_cartera; sin cuenta, cc_cartera_clientes.
create function public._cc_vendedor_de_cliente(p_customer uuid) returns uuid
  language sql stable set search_path = public as
$$ select case when cu.profile_id is not null then (select k.seller_profile_id from public.cc_cartera k where k.profile_id = cu.profile_id)
               else (select k.seller_profile_id from public.cc_cartera_clientes k where k.customer_id = cu.id) end
     from public.customers cu where cu.id = p_customer $$;

-- ¿Quien llama puede trabajar esta conversación? Dirección, o el asesor asignado que puede atender (misma regla que cc_contacto_de).
create function public._cc_puede_ver_conv(p_conv uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.auth_role() = 'admin'
       or exists (select 1 from public.cc_conversations c where c.id = p_conv and c.seller_profile_id = auth.uid() and public._cc_puede_atender(auth.uid())) $$;

-- ── 3) Sugerencias: ¿quién es esta persona? ───────────────────────────────────────────────────────────
create function public.cc_cliente_sugerencias(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare c record; v_tels text[]; v_mails text[]; v_frases text[]; v_out jsonb;
begin
  if not public._cc_puede_ver_conv(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv;
  if not found or c.profile_id is not null or c.visitor_id is null then return '[]'::jsonb; end if;   -- con cuenta ya se sabe quién es
  select array_agg(distinct x) into v_tels from (
      select public.norm_telefono_mx(w.wa_id) x from public.cc_wa_contactos w where w.visitor_id = c.visitor_id
      union select public.norm_telefono_mx(r.telefono) from public.cc_prerregistros r where r.visitor_id = c.visitor_id) t
   where x ~ '^[0-9]{10}$';
  select array_agg(distinct lower(btrim(r.email))) into v_mails from public.cc_prerregistros r where r.visitor_id = c.visitor_id and nullif(btrim(r.email), '') is not null;
  -- Frases donde puede venir su nombre: el del contacto y los mensajes cortos que escribió.
  select array_agg(f) into v_frases from (
      select public._cc_txt_norm(w.nombre) f from public.cc_wa_contactos w where w.visitor_id = c.visitor_id
      union all select public._cc_txt_norm(m.nombre) from public.cc_meta_contactos m where m.visitor_id = c.visitor_id
      union all select public._cc_txt_norm(r.nombre) from public.cc_prerregistros r where r.visitor_id = c.visitor_id
      union all select public._cc_txt_norm(mm.content) from (select m.content from public.cc_messages m where m.conversation_id = p_conv and m.actor_type in ('visitor', 'doctor')
                                                                and char_length(m.content) <= 80 order by m.seq desc limit 40) mm) t
   where f ~ '[a-z]{3}';
  with cand as (
    select cu.id, 3 as prio, 'telefono' as motivo from public.customers cu
     where cu.active and v_tels is not null
       and (public.norm_telefono_mx(cu.phone) = any (v_tels)
            or exists (select 1 from public.customer_phones p where p.customer_id = cu.id and p.activo and p.numero_norm = any (v_tels)))
    union all
    select cu.id, 3, 'correo' from public.customers cu where cu.active and v_mails is not null and lower(btrim(cu.email)) = any (v_mails)
    union all
    -- Nombre: al menos 2 palabras (de 3+ letras) de su nombre en una misma frase, y 2/3 de ellas.
    select cu.id, 1, 'nombre' from public.customers cu
     cross join lateral (select array_agg(t) toks from unnest(regexp_split_to_array(public._cc_txt_norm(cu.full_name), '\s+')) t where length(t) >= 3) nt
     where cu.active and v_frases is not null and cardinality(nt.toks) >= 2
       and exists (select 1 from unnest(v_frases) f
                    where (select count(*) from unnest(nt.toks) t where (' ' || f || ' ') like ('% ' || t || ' %')) >= greatest(2, ceil(cardinality(nt.toks) * 0.66)))
  ), mejor as (
    select distinct on (id) id, prio, motivo from cand order by id, prio desc
  )
  select coalesce(jsonb_agg(x order by (x ->> 'prio')::int desc, x ->> 'nombre'), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
             'customer_id', cu.id, 'nombre', public._c4a_nombre_visible(cu.full_name), 'motivo', m.motivo, 'prio', m.prio,
             'telefono', case when length(regexp_replace(coalesce(cu.phone, ''), '[^0-9]', '', 'g')) >= 8 then '••••' || right(regexp_replace(cu.phone, '[^0-9]', '', 'g'), 4) end,
             'ciudad', cu.city, 'tiene_cuenta', cu.profile_id is not null,
             'tu_cartera', public._cc_vendedor_de_cliente(cu.id) = auth.uid(),
             'vendedor', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = public._cc_vendedor_de_cliente(cu.id))) x
      from mejor m join public.customers cu on cu.id = m.id
     where public._c4a_nombre_visible(cu.full_name) is not null
       and not exists (select 1 from public.c4a_exclusiones e where e.customer_id = cu.id)
     order by m.prio desc limit 5) s;
  return v_out;
end;
$$;

-- ── 4) Vincular / desvincular ─────────────────────────────────────────────────────────────────────────
create function public.cc_vincular_cliente(p_conv uuid, p_customer uuid, p_guardar_numero boolean default true) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; cu record; v_rol text := public.auth_role(); s uuid; v_tel text; v_num boolean := false; v_cart boolean := false; v_reas boolean := false;
begin
  if not public._cc_puede_ver_conv(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.profile_id is not null then raise exception 'CONVERSACION_CON_CUENTA: esta persona ya tiene cuenta; su ficha se liga sola' using errcode = 'check_violation'; end if;
  select id, full_name, phone, profile_id, active into cu from public.customers where id = p_customer for update;
  if not found or exists (select 1 from public.c4a_exclusiones e where e.customer_id = p_customer) then raise exception 'CLIENTE_INEXISTENTE' using errcode = 'check_violation'; end if;
  if not cu.active then raise exception 'CLIENTE_INACTIVO: reactiva al cliente antes de vincularlo' using errcode = 'check_violation'; end if;
  if c.customer_id is not distinct from p_customer then
    return jsonb_build_object('customer_id', p_customer, 'idempotente', true);
  end if;
  update public.cc_conversations set customer_id = p_customer, updated_at = now() where id = p_conv;

  -- El número desde el que escribe queda en su ficha: la próxima vez se reconoce y llega a su vendedor.
  if coalesce(p_guardar_numero, true) then
    select public.norm_telefono_mx(w.wa_id) into v_tel from public.cc_wa_contactos w where w.visitor_id = c.visitor_id order by w.ultimo_entrante_at desc nulls last limit 1;
    if v_tel ~ '^[0-9]{10}$' and public.norm_telefono_mx(cu.phone) is distinct from v_tel
       and not exists (select 1 from public.customer_phones p where p.customer_id = p_customer and p.activo and p.numero_norm = v_tel) then
      insert into public.customer_phones (customer_id, numero, numero_norm, etiqueta, es_principal, activo, origen, created_by)
      values (p_customer, v_tel, v_tel, 'whatsapp', false, true, 'manual', auth.uid());
      perform public._c360_evento(p_customer, 'telefono_agregado', jsonb_build_object('numero', '••••' || right(v_tel, 4), 'origen', 'conversacion'), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
      v_num := true;
    end if;
  end if;

  -- Sin vendedor: quien la vincula (vendedor que puede recibir clientes) la toma, como en el reparto.
  s := public._cc_vendedor_de_cliente(p_customer);
  if s is null and v_rol = 'pos' and public._cc_vendedor_elegible(auth.uid(), false) then
    if cu.profile_id is null then
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_customer, auth.uid(), now(), auth.uid(), 'Vinculado desde una conversación');
      insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_customer, null, auth.uid(), auth.uid(), 'Vinculado desde una conversación');
    else
      insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (cu.profile_id, auth.uid(), now(), auth.uid(), 'Vinculado desde una conversación') on conflict (profile_id) do nothing;
      insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (cu.profile_id, null, auth.uid(), auth.uid(), 'Vinculado desde una conversación');
    end if;
    perform public._c360_evento(p_customer, 'vendedor_asignado', jsonb_build_object('vendedor', auth.uid(), 'por', 'conversacion'), 'vendedor');
    s := auth.uid(); v_cart := true;
  end if;

  -- La conversación va al vendedor de SU cartera (si está pidiendo o recibiendo atención y ese vendedor puede atender).
  if s is not null and c.modo in ('human_requested', 'human_assigned', 'human_active') and c.seller_profile_id is distinct from s and public._cc_vendedor_elegible(s, false) then
    perform public._cc_handler_asignar(p_conv, s, case when v_rol = 'admin' then 'admin' else 'seller' end, auth.uid(), 'cliente_vinculado', 'cartera');
    v_reas := true;
  end if;

  insert into public.cc_conversacion_cliente_hist (conversation_id, customer_anterior, customer_nuevo, actor_profile_id, detalle)
  values (p_conv, c.customer_id, p_customer, auth.uid(), jsonb_build_object('numero_guardado', v_num, 'cartera_asignada', v_cart, 'reasignada', v_reas));
  return jsonb_build_object('customer_id', p_customer, 'idempotente', false, 'numero_guardado', v_num, 'cartera_asignada', v_cart, 'reasignada', v_reas,
    'vendedor', s, 'vendedor_nombre', (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = s));
end;
$$;

create function public.cc_desvincular_cliente(p_conv uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record;
begin
  if not public._cc_puede_ver_conv(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.customer_id is null then return jsonb_build_object('idempotente', true); end if;
  update public.cc_conversations set customer_id = null, updated_at = now() where id = p_conv;
  insert into public.cc_conversacion_cliente_hist (conversation_id, customer_anterior, customer_nuevo, actor_profile_id, detalle)
  values (p_conv, c.customer_id, null, auth.uid(), '{"accion":"desvincular"}');
  return jsonb_build_object('idempotente', false);
end;
$$;

-- ── 5) Ficha corta para el panel del chat ─────────────────────────────────────────────────────────────
create function public.cc_cliente_de_conversacion(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare c record; cu record; v_id uuid; v_actor text; v_seller uuid; r jsonb;
begin
  if not public._cc_puede_ver_conv(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv;
  v_id := coalesce(c.customer_id, (select x.id from public.customers x where c.profile_id is not null and x.profile_id = c.profile_id limit 1));
  if v_id is null then return jsonb_build_object('vinculado', false, 'con_cuenta', c.profile_id is not null); end if;
  select * into cu from public.customers where id = v_id;
  v_actor := public._c360_actor(v_id);
  v_seller := public._cc_vendedor_de_cliente(v_id);
  r := jsonb_build_object('vinculado', true, 'customer_id', v_id, 'por', case when c.customer_id is not null then 'personal' else 'cuenta' end,
         'nombre', coalesce(public._c4a_nombre_visible(cu.full_name), 'Cliente'), 'ciudad', cu.city, 'activo', cu.active,
         'tiene_cuenta', cu.profile_id is not null, 'con_cuenta', c.profile_id is not null,
         'vendedor', v_seller, 'vendedor_nombre', (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = v_seller),
         'es_tuyo', v_actor in ('direccion', 'vendedor'));
  if v_actor in ('direccion', 'vendedor') then
    r := r || jsonb_build_object(
      'email', cu.email,
      'telefono', coalesce((select t.numero from public.customer_phones t where t.customer_id = v_id and t.activo order by t.es_principal desc, t.created_at limit 1), cu.phone),
      'pedidos', (select count(*) from public.orders o where o.customer_id = v_id and o.status <> 'draft'),
      'ultimo_pedido', (select jsonb_build_object('folio', o.external_ref, 'fecha', o.created_at, 'total', o.total, 'estado', o.status)
                          from public.orders o where o.customer_id = v_id and o.status <> 'draft' order by o.created_at desc limit 1),
      'invitacion_vigente', exists (select 1 from public.cliente_invitaciones i where i.customer_id = v_id and i.usada_at is null and i.revocada_at is null and i.expira_at > now()));
  end if;
  return r;
end;
$$;

revoke all on function public._cc_txt_norm(text), public._cc_vendedor_de_cliente(uuid), public._cc_puede_ver_conv(uuid) from public, anon;
grant execute on function public._cc_txt_norm(text), public._cc_vendedor_de_cliente(uuid), public._cc_puede_ver_conv(uuid) to authenticated, service_role;
revoke all on function public.cc_cliente_sugerencias(uuid), public.cc_vincular_cliente(uuid, uuid, boolean), public.cc_desvincular_cliente(uuid), public.cc_cliente_de_conversacion(uuid) from public, anon;
grant execute on function public.cc_cliente_sugerencias(uuid), public.cc_vincular_cliente(uuid, uuid, boolean), public.cc_desvincular_cliente(uuid), public.cc_cliente_de_conversacion(uuid) to authenticated, service_role;

-- ── 6) Ruteo, nombre del dueño, Bandeja y cola con el cliente vinculado ───────────────────────────────
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
$function$;

CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else coalesce((select cu.full_name || ' (cliente)' from public.customers cu where cu.id = c.customer_id), (select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), (select coalesce(w.nombre, '+' || w.wa_id) || ' (WhatsApp)' from public.cc_wa_contactos w where w.visitor_id = c.visitor_id), (select coalesce(m.nombre, 'Contacto') || case m.canal when 'instagram' then ' (Instagram)' else ' (Facebook)' end from public.cc_meta_contactos m where m.visitor_id = c.visitor_id), 'Visitante') end
     from public.cc_conversations c where c.id = p_conv $function$;

CREATE OR REPLACE FUNCTION public.cc_bandeja_unificada(p_limite integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lim int := least(greatest(coalesce(p_limite, 300), 1), 500); v jsonb;
begin
  perform public._cc7_direccion();
  with base as (
    select c.*,
           (select m.actor_type from public.cc_messages m where m.conversation_id = c.id and m.actor_type <> 'system' order by m.seq desc limit 1) as ultimo_actor,
           (select m.created_at from public.cc_messages m where m.conversation_id = c.id and m.actor_type in ('visitor', 'doctor') order by m.seq desc limit 1) as ultimo_cliente_at
      from public.cc_conversations c
     where c.estado = 'abierta'
       and (c.modo in ('human_requested', 'human_assigned', 'human_active') or c.last_message_at > now() - interval '30 days')
  ), clas as (
    select b.*,
           (b.ultimo_actor in ('visitor', 'doctor') and b.ultimo_cliente_at < now() - interval '3 minutes' and b.ultimo_cliente_at > now() - interval '24 hours') as sin_responder,
           case when b.modo = 'human_active' then 'en_atencion'
                when b.modo in ('human_requested', 'human_assigned') then 'por_atender'
                when b.ultimo_actor in ('visitor', 'doctor') and b.ultimo_cliente_at < now() - interval '3 minutes' and b.ultimo_cliente_at > now() - interval '24 hours' then 'por_atender'
                else 'ia' end as grupo
      from base b
  ), orden as (
    select clas.*, row_number() over (order by case grupo when 'por_atender' then 0 when 'en_atencion' then 1 else 2 end,
              case when grupo = 'por_atender' then coalesce(asesoria_solicitada_at, ultimo_cliente_at) end asc nulls last,
              last_message_at desc nulls last, id) as ord
      from clas
  )
  select jsonb_build_object(
    'resumen', jsonb_build_object(
      'por_atender', (select count(*) from clas where grupo = 'por_atender'),
      'en_atencion', (select count(*) from clas where grupo = 'en_atencion'),
      'ia', (select count(*) from clas where grupo = 'ia'),
      'todas', (select count(*) from clas)),
    'conversaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'conversation_id', o.id, 'grupo', o.grupo, 'modo', o.modo, 'dueno', case when o.profile_id is not null then 'doctor' else 'visitante' end, 'profile_id', o.profile_id,
        'nombre', case when o.profile_id is not null then (select coalesce(p.full_name, p.meta ->> 'name') from public.profiles p where p.id = o.profile_id)
                       else coalesce((select cu.full_name from public.customers cu where cu.id = o.customer_id), (select r.nombre from public.cc_prerregistros r where r.visitor_id = o.visitor_id), 'Visitante') end,
        'customer_id', coalesce(o.customer_id, (select cu.id from public.customers cu where cu.profile_id = o.profile_id limit 1)),
        'seller_id', o.seller_profile_id, 'seller_nombre', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = o.seller_profile_id),
        'tomada', o.tomada_por is not null, 'ruteo_motivo', o.ruteo_motivo, 'origen', o.handoff_origen, 'fuera_horario', o.handoff_fuera_horario,
        'solicitado_at', o.asesoria_solicitada_at,
        'edad_min', case when o.asesoria_solicitada_at is null then null else (extract(epoch from (now() - o.asesoria_solicitada_at)) / 60)::int end,
        'iniciada', o.modo = 'human_active', 'cart_id', o.handoff_cart_id, 'n_items', 0,
        'sin_responder', o.sin_responder, 'ultimo_actor', o.ultimo_actor,
        'hace_min', case when o.last_message_at is null then null else (extract(epoch from (now() - o.last_message_at)) / 60)::int end,
        'atencion', case when o.modo in ('human_requested', 'human_assigned', 'human_active') then public._cc_atencion(o.id) end,
        'contacto', public._cc_contacto_conversacion(o.id)) order by o.ord) from orden o where o.ord <= lim), '[]'::jsonb))
    into v;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_cola_asesorias()
 RETURNS TABLE(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamp with time zone, last_message_at timestamp with time zone, es_mia boolean, sin_leer bigint, dueno text, handoff_origen text, fuera_horario boolean, ruteo_motivo text, cart_id uuid, n_items integer, edad_min integer, iniciada boolean, atencion jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor') else coalesce((select cu.full_name from public.customers cu where cu.id = c.customer_id), (select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), 'Visitante') end as dueno,
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
  if position('VINCULAR-CLIENTE' in pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = 0
     or position('customer_id' in pg_get_functiondef('public.cc_bandeja_unificada(integer)'::regprocedure)) = 0 then
    raise exception 'VINCULAR-CLIENTE: no quedó aplicada'; end if;
end $post$;
