-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ENLACE POR VENDEDOR + REFERIDOS (30 oct 2026). Sustituye "un solo enlace, quien lo comparte no decide" (CX-ENLACE).
--   Dueño: "cada vendedor tiene que tener su propio url porque ellos compiten por clientes… quieren que el cliente llegue
--   directo al [vendedor] que puso el url"; y "si el cliente quiere recomendar Renovacell… pueda mandar el link del chat
--   con el vendedor" desde su portal. Renovacell quiere reducir WhatsApp al máximo: el enlace es el chat propio.
--   · cc_enlaces: un enlace legible por vendedor (renovacell.mx/contacto/roberto-ibarra) y uno por cliente que recomienda
--     (renovacell.mx/contacto/lourdes-k7m2). El de un cliente lleva al vendedor de SU cartera (se resuelve al usarse).
--   · El visitante guarda el PRIMER enlace por el que llegó (vendedor y, si aplica, quién lo recomendó).
--   · Ruteo (decisión del dueño: GANA LA CARTERA): asesor ya puesto → ficha vinculada → coincidencia del prerregistro con
--     un cliente de cartera → vendedor del enlace → reparto. Si la cartera le gana a su enlace, al vendedor se le avisa.
--   · El prospecto queda asignado al vendedor del enlace y, al verificarse, entra a su cartera.
--   · cc_enlace_publico (vía Edge visitor, sin sesión): lo mínimo para que quien recibe el enlace confíe — nombre y foto del asesor y el primer
--     nombre de quien lo recomendó. Nada más.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_enlaces') is not null then raise exception 'ENLACE-VENDEDOR: ya aplicada'; end if;
  if to_regprocedure('public._cc_rutear(uuid)') is null or to_regprocedure('public._vendedor_de_doctor(uuid)') is null
     or to_regprocedure('public._cc_vendedor_de_cliente(uuid)') is null or to_regclass('public.cc_prerregistros') is null
     or to_regprocedure('public.cc_visitante_prerregistrar(text,text,text,text,boolean,text,boolean)') is null then
    raise exception 'ENLACE-VENDEDOR: faltan CX-ENLACE (150), AVISO-VERIF o VINCULAR-CLIENTE (20270206)'; end if;
end $pre$;

-- ── 1) Enlaces ───────────────────────────────────────────────────────────────────────────────────────
create table public.cc_enlaces (
  codigo            text primary key,
  tipo              text not null,
  seller_profile_id uuid references public.profiles(id) on delete cascade,   -- 'vendedor': el dueño del enlace
  customer_id       uuid references public.customers(id) on delete cascade,  -- 'referido': quien recomienda
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint ck_cce_codigo check (codigo ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(codigo) between 3 and 40),
  constraint ck_cce_tipo check ((tipo = 'vendedor' and seller_profile_id is not null and customer_id is null)
                             or (tipo = 'referido' and customer_id is not null and seller_profile_id is null))
);
create unique index ux_cce_vendedor on public.cc_enlaces (seller_profile_id) where tipo = 'vendedor' and activo;
create unique index ux_cce_referido on public.cc_enlaces (customer_id) where tipo = 'referido' and activo;
alter table public.cc_enlaces enable row level security;   -- sin políticas: solo por las funciones de abajo
revoke all on public.cc_enlaces from anon, authenticated;

alter table public.cc_visitors
  add column enlace_codigo text references public.cc_enlaces(codigo) on delete set null,
  add column referido_por  uuid references public.customers(id) on delete set null;
alter table public.cc_visitor_events drop constraint ck_ccve_tipo;
alter table public.cc_visitor_events add constraint ck_ccve_tipo
  check (tipo = any (array['abierto', 'last_touch', 'prospecto', 'registro', 'adoptado', 'conflicto', 'revocado', 'prerregistro', 'enlace']));

-- Texto → parte de un código legible ("María José Pérez" → "maria-jose-perez").
create function public._cc_slug(p text) returns text language sql immutable set search_path = public as
$$ select nullif(btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'), '[^a-z0-9]+', '-', 'g'), '-'), '') $$;

-- Nombre visible del personal y primer nombre sin títulos: _cc_nombre_personal (CHAT V2-D1) y _cc_primer_nombre (existentes).

-- Resuelve un código: tipo, vendedor que atiende y quién recomienda. Vendedor inactivo o sin capacidad → sin vendedor.
create function public._cc_enlace(p_codigo text, out tipo text, out seller uuid, out customer uuid) language plpgsql stable security definer set search_path = public as
$$
declare e public.cc_enlaces;
begin
  select * into e from public.cc_enlaces where codigo = lower(btrim(coalesce(p_codigo, ''))) and activo;
  if not found then return; end if;
  tipo := e.tipo; customer := e.customer_id;
  seller := case when e.tipo = 'vendedor' then e.seller_profile_id else public._cc_vendedor_de_cliente(e.customer_id) end;
  if seller is not null and not public._cc_vendedor_elegible(seller, false) then seller := null; end if;
end;
$$;

-- Crea (o devuelve) el enlace de un vendedor: su nombre; si ya está tomado, con número.
create function public._cc_enlace_de_vendedor(p_seller uuid) returns text language plpgsql security definer set search_path = public as
$$
declare v text; base text; i int := 1;
begin
  select codigo into v from public.cc_enlaces where tipo = 'vendedor' and seller_profile_id = p_seller and activo;
  if found then return v; end if;
  base := left(coalesce(public._cc_slug(public._cc_nombre_personal(p_seller)), 'asesor'), 34);
  if length(base) < 3 then base := 'asesor-' || base; end if;
  v := base;
  while exists (select 1 from public.cc_enlaces where codigo = v) loop i := i + 1; v := base || '-' || i; end loop;
  insert into public.cc_enlaces (codigo, tipo, seller_profile_id) values (v, 'vendedor', p_seller);
  return v;
end;
$$;

-- Crea (o devuelve) el enlace para recomendar de un cliente: su primer nombre + 4 caracteres al azar (no adivinable).
create function public._cc_enlace_de_cliente(p_customer uuid) returns text language plpgsql security definer set search_path = public as
$$
declare v text; base text;
begin
  select codigo into v from public.cc_enlaces where tipo = 'referido' and customer_id = p_customer and activo;
  if found then return v; end if;
  base := left(coalesce(public._cc_slug(public._cc_primer_nombre((select full_name from public.customers where id = p_customer))), 'amigo'), 20);
  if length(base) < 2 then base := 'amigo'; end if;
  loop
    v := base || '-' || (select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from public.cc_enlaces where codigo = v);
  end loop;
  insert into public.cc_enlaces (codigo, tipo, customer_id) values (v, 'referido', p_customer);
  return v;
end;
$$;

-- Cuántas personas trajo un enlace (para que cada quien vea su avance).
create function public._cc_enlace_cifras(p_codigo text) returns jsonb language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'visitas', (select count(*) from public.cc_visitors v where v.enlace_codigo = p_codigo),
    'contactos', (select count(*) from public.cc_visitors v join public.cc_prerregistros r on r.visitor_id = v.id where v.enlace_codigo = p_codigo),
    'cuentas', (select count(*) from public.cc_visitors v where v.enlace_codigo = p_codigo and v.adopted_profile_id is not null))
$$;

revoke all on function public._cc_slug(text), public._cc_enlace(text),
  public._cc_enlace_de_vendedor(uuid), public._cc_enlace_de_cliente(uuid), public._cc_enlace_cifras(text) from public, anon, authenticated;

-- ── 2) Lo público: quien recibe el enlace ve con quién va a hablar y quién lo recomendó ───────────────
create function public.cc_enlace_publico(p_codigo text) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare r record; v_nombre text;
begin
  select * into r from public._cc_enlace(p_codigo);
  if r.tipo is null then return jsonb_build_object('valido', false); end if;
  v_nombre := public._cc_nombre_personal(r.seller);
  return jsonb_build_object('valido', true, 'tipo', r.tipo,
    'asesor', case when r.seller is not null then jsonb_build_object('nombre', v_nombre, 'primer_nombre', public._cc_primer_nombre(v_nombre),
                    'foto', (select x.meta ->> 'avatar_url' from public.profiles x where x.id = r.seller)) end,
    'recomienda', case when r.customer is not null then public._cc_primer_nombre((select full_name from public.customers where id = r.customer)) end);
end;
$$;
revoke all on function public.cc_enlace_publico(text) from public, anon, authenticated;
grant execute on function public.cc_enlace_publico(text) to service_role;   -- la Edge visitor (ver_enlace) es la única puerta

-- El visitante llegó por un enlace (Edge visitor, acción 'enlace'). Gana el PRIMER enlace: después no se re-atribuye.
create function public.cc_visitante_enlace(p_hash text, p_codigo text) returns jsonb language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v public.cc_visitors; r record;
begin
  v_id := public._cc_visitor_por_hash(p_hash);
  if v_id is null then raise exception 'SESION_INVALIDA'; end if;
  select * into v from public.cc_visitors where id = v_id for update;
  select * into r from public._cc_enlace(p_codigo);
  if r.tipo is not null and v.enlace_codigo is null and v.estado = 'activo' then
    update public.cc_visitors set enlace_codigo = lower(btrim(p_codigo)), referido_por = r.customer,
           seller_profile_id = coalesce(r.seller, seller_profile_id)
     where id = v_id;
    insert into public.cc_visitor_events (visitor_id, tipo, detalle)
    values (v_id, 'enlace', jsonb_build_object('codigo', lower(btrim(p_codigo)), 'tipo', r.tipo, 'seller', r.seller, 'referido_por', r.customer));
    -- Si ya tenía conversación abierta sin asesor, la preferencia queda a la vista de quien atienda (no asigna).
    update public.cc_conversations set seller_preferido_id = r.seller where visitor_id = v_id and estado = 'abierta' and seller_preferido_id is null and r.seller is not null;
  end if;
  return public.cc_enlace_publico(p_codigo);
end;
$$;
revoke all on function public.cc_visitante_enlace(text, text) from public, anon, authenticated;
grant execute on function public.cc_visitante_enlace(text, text) to service_role;

-- ── 3) Mi enlace: el vendedor (o Dirección para su equipo) y el cliente que recomienda ─────────────────
create function public.cc_mi_enlace() returns jsonb language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_role text := public.auth_role(); v_cod text; v_cust uuid; v_seller uuid; v_nom text;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO'; end if;
  if v_role = 'pos' then
    if not public._cc_vendedor_elegible(v_uid, false) then raise exception 'NO_AUTORIZADO: tu cuenta no atiende conversaciones'; end if;
    v_cod := public._cc_enlace_de_vendedor(v_uid);
    return jsonb_build_object('tipo', 'vendedor', 'codigo', v_cod, 'cifras', public._cc_enlace_cifras(v_cod));
  elsif v_role = 'doctor' then
    select id into v_cust from public.customers where profile_id = v_uid order by created_at limit 1;
    if v_cust is null then raise exception 'SIN_FICHA: aún no tienes ficha de cliente'; end if;
    v_cod := public._cc_enlace_de_cliente(v_cust);
    v_seller := public._cc_vendedor_de_cliente(v_cust);
    v_nom := public._cc_nombre_personal(v_seller);
    return jsonb_build_object('tipo', 'referido', 'codigo', v_cod, 'cifras', public._cc_enlace_cifras(v_cod),
      'asesor', case when v_seller is not null and public._cc_vendedor_elegible(v_seller, false) then jsonb_build_object('nombre', v_nom, 'primer_nombre', public._cc_primer_nombre(v_nom)) end);
  end if;
  raise exception 'NO_AUTORIZADO';
end;
$$;
revoke all on function public.cc_mi_enlace() from public, anon;
grant execute on function public.cc_mi_enlace() to authenticated;

-- Dirección: el enlace de cada vendedor que atiende conversaciones, con sus cifras (los crea si faltan).
create function public.cc_enlaces_equipo() returns jsonb language plpgsql security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('seller', x.id, 'nombre', public._cc_nombre_personal(x.id), 'codigo', c, 'cifras', public._cc_enlace_cifras(c)) order by public._cc_nombre_personal(x.id))
    from (select p.id, public._cc_enlace_de_vendedor(p.id) c from public.profiles p
           where p.role_id = 'pos' and p.active and not coalesce(p.interna, false) and public._cc_vendedor_elegible(p.id, false)) x), '[]'::jsonb);
end;
$$;
revoke all on function public.cc_enlaces_equipo() from public, anon;
grant execute on function public.cc_enlaces_equipo() to authenticated;

-- Quien atiende ve de dónde llegó la conversación: por SU enlace, por el de otro, o recomendada por un cliente.
create function public.cc_origen_conversacion(p_conv uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v public.cc_visitors; e public.cc_enlaces;
begin
  if not public._cc_puede_ver_conv(p_conv) then raise exception 'NO_AUTORIZADO'; end if;
  select v2.* into v from public.cc_conversations c join public.cc_visitors v2 on v2.id = c.visitor_id where c.id = p_conv;
  if v.enlace_codigo is null then return null; end if;
  select * into e from public.cc_enlaces where codigo = v.enlace_codigo;
  return jsonb_build_object('tipo', e.tipo, 'codigo', e.codigo,
    'vendedor', public._cc_nombre_personal(v.seller_profile_id), 'es_tuyo', v.seller_profile_id = auth.uid(),
    'recomienda', (select full_name from public.customers where id = v.referido_por));
end;
$$;
revoke all on function public.cc_origen_conversacion(uuid) from public, anon;
grant execute on function public.cc_origen_conversacion(uuid) to authenticated;

-- ── 4) Ruteo: el vendedor del enlace entra después de la cartera y antes del reparto ──────────────────
create or replace function public._cc_rutear(p_conv uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare c record; s uuid; v_motivo text; cfg record; v_ref uuid;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.modo <> 'human_requested' then
    return jsonb_build_object('asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'), 'sin_cambio', true);
  end if;
  if c.profile_id is null then
    -- ENLACE-VENDEDOR · el vendedor del enlace por el que llegó (si sigue atendiendo).
    select v.seller_profile_id into v_ref from public.cc_visitors v
     where v.id = c.visitor_id and v.enlace_codigo is not null and v.seller_profile_id is not null and public._cc_vendedor_elegible(v.seller_profile_id, false);
    -- Visitante: no hay cartera; solo un asesor que Dirección ya le haya puesto a ESTA conversación.
    if c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id) then s := c.seller_profile_id;
    -- VINCULAR-CLIENTE · el personal ya confirmó quién es: va al vendedor de SU cartera.
    elsif c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then s := public._cc_vendedor_de_cliente(c.customer_id);
    else
      -- CX-ENLACE · su prerregistro coincide con un cliente que tiene vendedor: va a ESE vendedor (posible cliente, sin confirmar).
      select r.posible_seller_id into s from public.cc_prerregistros r
       where r.visitor_id = c.visitor_id and r.posible_seller_id is not null and public._cc_vendedor_elegible(r.posible_seller_id, false);
      -- ENLACE-VENDEDOR · gana la cartera; si no hay cartera, el vendedor del enlace.
      if s is null then s := v_ref; end if;
      if s is null then v_motivo := 'visitante'; end if;
    end if;
    -- Gana la cartera (decisión del dueño): al vendedor del enlace se le avisa una vez que ese contacto ya tenía vendedor.
    if s is not null and v_ref is not null and s is distinct from v_ref and c.seller_profile_id is null then
      perform public._cc_notificar('contacto_enlace', p_conv, array[v_ref], null,
        'Un contacto de tu enlace ya es cliente de ' || coalesce(public._cc_nombre_personal(s), 'otro vendedor') || ': la conversación le llega a esa persona.',
        'asesorias', 'enlace_conflicto:' || c.visitor_id::text);
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
    perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', 'system', null, null, jsonb_build_object('seller', s, 'origen', case when c.profile_id is null then (case when s = v_ref then 'enlace' else 'conversacion' end) else 'cartera' end));
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

-- ── 5) Prerregistro: el prospecto y el aviso van al vendedor del enlace cuando no hay cartera ─────────
create or replace function public.cc_visitante_prerregistrar(p_hash text, p_nombre text, p_telefono text, p_email text, p_es_medico boolean, p_cedula text, p_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

-- ── 6) Al verificarse, entra a la cartera del vendedor del enlace (si no tenía otro camino) ────────────
create or replace function public._vendedor_de_doctor(p_profile uuid) returns uuid
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
      order by r.created_at desc limit 1),
    -- ENLACE-VENDEDOR · el vendedor del enlace por el que llegó.
    (select v.seller_profile_id from public.cc_visitors v
      where (v.pending_profile_id = p_profile or v.adopted_profile_id = p_profile) and v.enlace_codigo is not null and v.seller_profile_id is not null
        and public._cc_puede_atender(v.seller_profile_id)
      order by v.created_at limit 1))
$$;

do $post$ begin
  if to_regprocedure('public.cc_enlace_publico(text)') is null or to_regprocedure('public.cc_mi_enlace()') is null
     or to_regprocedure('public.cc_visitante_enlace(text,text)') is null then
    raise exception 'ENLACE-VENDEDOR: no quedó aplicada'; end if;
end $post$;
