-- ============================================================================
-- LINK DE PAGO CON TARJETA (2 nov 2026, dueño: Renovacell "no ha conectado link de pago, pero el cliente sí puede pedir
-- link y se lo mandan; lo sacan manualmente de la app del banco" · quién: "los vendedores" · banco: BanBajío).
-- Sin integración con el banco: el sistema pide, entrega y registra.
--   1) El cliente lo pide (portal, WhatsApp con la IA, o su vendedor por él) → aviso ruidoso a su vendedor (o a Dirección).
--   2) El vendedor saca el link en la app de BanBajío por el SALDO exacto y lo pega → se le entrega al cliente por su
--      WhatsApp vinculado, por correo y en su pedido del portal ("Pagar con tarjeta").
--   3) Al ver el cobro en el banco, Dirección o Facturación lo marcan pagado → registrar_cobro (método tarjeta): el mismo
--      libro de siempre (saldo, conciliación, cortes). El vendedor NO marca pagos (SEC-B: el cobro lo registra admin/billing).
-- Un solo link activo por pedido; solo https; se guarda el dominio y si es de BanBajío (aviso, no bloqueo: no hay lista
-- oficial de dominios de sus links).
-- ============================================================================
create table if not exists public.pago_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  estado text not null default 'solicitado' check (estado in ('solicitado', 'enviado', 'pagado', 'cancelado')),
  monto numeric(12,2) not null check (monto > 0),
  via text not null check (via in ('portal', 'whatsapp', 'personal')),
  solicitado_por uuid,
  url text check (url is null or (url ~ '^https://[^[:space:]]+$' and length(url) <= 2000)),
  dominio text,
  banbajio boolean,
  enviado_por uuid, enviado_at timestamptz,
  referencia text, pagado_por uuid, pagado_at timestamptz, cobro jsonb,
  cancelado_por uuid, cancelado_at timestamptz, motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pago_links_un_activo on public.pago_links (order_id) where estado in ('solicitado', 'enviado');
create index if not exists pago_links_estado on public.pago_links (estado, created_at desc);
alter table public.pago_links enable row level security;   -- sin políticas: todo pasa por las funciones de abajo
revoke all on public.pago_links from public, anon, authenticated;

-- El correo con el link usa su propia plantilla (comm-dispatch la arma).
alter table public.comm_outbox drop constraint if exists ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla = any (array['pedido_recibido', 'pago_recibido', 'pedido_enviado',
  'pedido_entregado', 'pedido_cancelado', 'reembolso_realizado', 'registro_recibido', 'cuenta_verificada', 'verificacion_rechazada', 'promocion',
  'cotizacion', 'difusion', 'link_pago']));

-- Vendedor del pedido: cartera del doctor; si no, cartera de la ficha del cliente. null = Dirección.
create or replace function public._lp_vendedor(p_order uuid) returns uuid
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select k.seller_profile_id from public.orders o join public.cc_cartera k on k.profile_id = o.doctor_id where o.id = p_order),
    (select k.seller_profile_id from public.orders o join public.cc_cartera_clientes k on k.customer_id = o.customer_id where o.id = p_order))
$$;

create or replace function public._lp_avisar(p_order uuid, p_kind text, p_texto text, p_llave text) returns void
  language plpgsql security definer set search_path = public as
$$
declare v_s uuid := public._lp_vendedor(p_order);
begin
  if v_s is not null then perform public._cc_notificar(p_kind, null, array[v_s], null, p_texto, 'links_pago', p_llave);
  else perform public._cc_notificar(p_kind, null, null, array['admin'], p_texto, 'av_links', p_llave); end if;
end;
$$;

create or replace function public._lp_json(l public.pago_links) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('id', l.id, 'order_id', l.order_id, 'folio', o.external_ref, 'estado', l.estado, 'monto', l.monto, 'via', l.via,
    'url', case when l.estado in ('enviado', 'pagado') then l.url end, 'dominio', l.dominio, 'banbajio', l.banbajio,
    'created_at', l.created_at, 'enviado_at', l.enviado_at, 'pagado_at', l.pagado_at, 'referencia', l.referencia)
  from public.orders o where o.id = l.order_id
$$;

-- Núcleo de la solicitud (lo usan el portal, el personal y la IA). Idempotente: si ya hay uno activo, regresa ese.
create or replace function public._lp_solicitar(p_order uuid, p_via text, p_actor uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare o record; m record; l public.pago_links; v_nombre text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado' using errcode = 'check_violation'; end if;
  select * into l from public.pago_links where order_id = p_order and estado in ('solicitado', 'enviado');
  if found then return public._lp_json(l) || jsonb_build_object('ya_existia', true); end if;
  select * into m from public.v_order_money where order_id = p_order;
  if coalesce(m.saldo, 0) <= 0 then raise exception 'SIN_SALDO: ese pedido ya no tiene saldo por cobrar' using errcode = 'check_violation'; end if;
  insert into public.pago_links (order_id, monto, via, solicitado_por) values (p_order, m.saldo, p_via, p_actor) returning * into l;
  select coalesce(c.full_name, p.full_name) into v_nombre from public.orders x left join public.customers c on c.id = x.customer_id left join public.profiles p on p.id = x.doctor_id where x.id = p_order;
  perform public._lp_avisar(p_order, 'link_pago',
    coalesce(v_nombre, 'Un cliente') || ' pide link de pago con tarjeta · pedido ' || coalesce(o.external_ref, '') || ' · ' || public._cc_dinero(m.saldo) || '. Sácalo en la app de BanBajío y pégalo en Links de pago.',
    'link_pago:' || l.id);
  return public._lp_json(l) || jsonb_build_object('ya_existia', false);
end;
$$;

-- Portal (el doctor, su pedido) o personal (vendedor, Dirección, Facturación) por el cliente.
create or replace function public.link_pago_solicitar(p_order uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_rol text := public.auth_role(); v_uid uuid := auth.uid();
begin
  if v_rol = 'doctor' then
    if not exists (select 1 from public.orders where id = p_order and doctor_id = v_uid) then raise exception 'PEDIDO_INEXISTENTE' using errcode = 'check_violation'; end if;
    return public._lp_solicitar(p_order, 'portal', v_uid);
  elsif v_rol = any (array['pos', 'admin', 'billing']) then
    return public._lp_solicitar(p_order, 'personal', v_uid);
  end if;
  raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
end;
$$;

-- WhatsApp: la IA lo pide por el doctor VINCULADO (folio opcional; sin folio, su pedido más reciente con saldo).
create or replace function public.cc_ia_link_pago(p_conv uuid, p_profile uuid, p_folio text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_order uuid;
begin
  perform public._cc_ia_exige_identidad(p_conv, p_profile);
  select o.id into v_order from public.orders o join public.v_order_money m on m.order_id = o.id
   where o.doctor_id = p_profile and o.status <> 'cancelled' and m.saldo > 0
     and (nullif(btrim(coalesce(p_folio, '')), '') is null or upper(o.external_ref) = upper(btrim(p_folio)))
   order by o.created_at desc limit 1;
  if v_order is null then return jsonb_build_object('solicitado', false, 'motivo', 'SIN_PEDIDO_CON_SALDO'); end if;
  -- La IA nunca escribe el link (un link de pago mal copiado es un riesgo): lo entrega el sistema tal cual lo pegó el vendedor.
  return (public._lp_solicitar(v_order, 'whatsapp', null) - 'url') || jsonb_build_object('solicitado', true);
end;
$$;

-- El vendedor pega el link que sacó en BanBajío: se entrega por WhatsApp (si lo vinculó), correo y su pedido del portal.
create or replace function public.link_pago_enviar(p_link uuid, p_url text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare l public.pago_links; o record; v_url text := btrim(coalesce(p_url, '')); v_dom text; v_bb boolean; v_conv uuid; v_seq bigint; v_t text; v_nombre text;
begin
  if not (public.auth_role() = any (array['pos', 'admin', 'billing'])) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_url !~ '^https://[^[:space:]]+$' or length(v_url) > 2000 then raise exception 'LINK_INVALIDO: pega el link completo que empieza con https://' using errcode = 'check_violation'; end if;
  select * into l from public.pago_links where id = p_link for update;
  if not found or l.estado not in ('solicitado', 'enviado') then raise exception 'LINK_NO_ACTIVO: esa solicitud ya no está activa' using errcode = 'check_violation'; end if;
  v_dom := lower(substring(v_url from '^https://([^/:?#]+)'));
  v_bb := v_dom ~ '(bajio|bb\.com\.mx)';
  update public.pago_links set url = v_url, dominio = v_dom, banbajio = v_bb, estado = 'enviado', enviado_por = auth.uid(), enviado_at = now(), updated_at = now()
   where id = l.id returning * into l;
  select x.external_ref, x.doctor_id, x.customer_id into o from public.orders x where x.id = l.order_id;

  -- WhatsApp del doctor vinculado (su conversación abierta de WhatsApp). Si no se puede, no detiene la entrega.
  begin
    select c.id into v_conv from public.cc_wa_contactos w join public.cc_conversations c on c.visitor_id = w.visitor_id and c.profile_id is null
     where o.doctor_id is not null and w.vinculo_profile_id = o.doctor_id and c.estado = 'abierta' order by c.last_message_at desc nulls last limit 1;
    if v_conv is not null then
      select public._cc_primer_nombre(full_name) into v_nombre from public.profiles where id = o.doctor_id;
      v_t := 'Listo' || coalesce(', ' || v_nombre, '') || '. Aquí está tu link de pago con tarjeta del pedido ' || coalesce(o.external_ref, '') || ' por ' || public._cc_dinero(l.monto) || ' (BanBajío): ' || v_url
          || E'\n\n' || 'En cuanto se refleje el pago te avisamos. También lo tienes en tu pedido en sistema.renovacell.mx.';
      update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = v_conv returning ultimo_seq into v_seq;
      insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
      values (v_conv, v_seq, 'ai', 'tpl:link_pago:' || l.id || ':' || left(md5(v_url), 8), v_t, md5(v_t)) on conflict do nothing;
    end if;
  exception when others then v_conv := null;
  end;
  perform public._comm_encolar('link_pago:' || l.id || ':' || left(md5(v_url), 8), 'link_pago', l.order_id, jsonb_build_object('url', v_url, 'monto', l.monto));
  if o.doctor_id is not null then
    perform public._cc_notificar('link_pago_listo', null, array[o.doctor_id], null, 'Tu link de pago con tarjeta del pedido ' || coalesce(o.external_ref, '') || ' ya está listo.', 'g_pedidosdr', 'link_pago_listo:' || l.id || ':' || left(md5(v_url), 8));
  end if;
  return public._lp_json(l) || jsonb_build_object('whatsapp', v_conv is not null);
end;
$$;

create or replace function public.link_pago_cancelar(p_link uuid, p_motivo text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare l public.pago_links;
begin
  if not (public.auth_role() = any (array['pos', 'admin', 'billing'])) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.pago_links set estado = 'cancelado', cancelado_por = auth.uid(), cancelado_at = now(), motivo = nullif(btrim(left(coalesce(p_motivo, ''), 300)), ''), updated_at = now()
   where id = p_link and estado in ('solicitado', 'enviado') returning * into l;
  if not found then raise exception 'LINK_NO_ACTIVO: esa solicitud ya no está activa' using errcode = 'check_violation'; end if;
  return public._lp_json(l);
end;
$$;

-- Dirección / Facturación: el cobro ya se ve en BanBajío → se registra como cobro con tarjeta (libro de siempre).
create or replace function public.link_pago_pagado(p_link uuid, p_referencia text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare l public.pago_links; v_cobro jsonb;
begin
  if not (public.auth_role() = any (array['admin', 'billing'])) then raise exception 'NO_AUTORIZADO: el cobro lo registran Dirección o Facturación' using errcode = 'insufficient_privilege'; end if;
  select * into l from public.pago_links where id = p_link for update;
  if not found or l.estado <> 'enviado' then raise exception 'LINK_NO_ENVIADO: solo se marca pagado un link ya enviado' using errcode = 'check_violation'; end if;
  v_cobro := public.registrar_cobro(gen_random_uuid(), l.order_id, 'tarjeta', l.monto, public.hoy_local(),
    left('Link BanBajío' || coalesce(' · ' || nullif(btrim(p_referencia), ''), ''), 200), null, l.url);
  update public.pago_links set estado = 'pagado', pagado_por = auth.uid(), pagado_at = now(), referencia = nullif(btrim(left(coalesce(p_referencia, ''), 200)), ''), cobro = v_cobro, updated_at = now()
   where id = l.id returning * into l;
  return public._lp_json(l) || jsonb_build_object('cobro', v_cobro);
end;
$$;

-- Lista del personal: activos y los de los últimos 30 días.
create or replace function public.links_pago_lista() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not (public.auth_role() = any (array['pos', 'admin', 'billing'])) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(public._lp_json(l) || jsonb_build_object('cliente', coalesce(c.full_name, p.full_name), 'vendedor', v.full_name,
                                     'es_mio', public._lp_vendedor(l.order_id) = auth.uid(), 'url_guardada', l.url)
                                   order by (l.estado in ('solicitado', 'enviado')) desc, l.created_at desc)
    from public.pago_links l join public.orders o on o.id = l.order_id left join public.customers c on c.id = o.customer_id
    left join public.profiles p on p.id = o.doctor_id left join public.profiles v on v.id = public._lp_vendedor(l.order_id)
   where l.estado in ('solicitado', 'enviado') or l.updated_at > now() - interval '30 days'), '[]'::jsonb);
end;
$$;

-- El link vigente (o el último) de un pedido: el doctor el suyo; el personal cualquiera.
create or replace function public.link_pago_de_pedido(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare l public.pago_links;
begin
  if not (public.auth_role() = any (array['pos', 'admin', 'billing'])
          or (public.auth_role() = 'doctor' and exists (select 1 from public.orders where id = p_order and doctor_id = auth.uid()))) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  select * into l from public.pago_links where order_id = p_order and estado <> 'cancelado' order by created_at desc limit 1;
  return case when found then public._lp_json(l) end;
end;
$$;

-- El aviso de "pide link" suena y llega como push urgente, como las demás alertas comerciales.
create or replace function public.aviso_push_carga(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare n public.notifications; v_perfiles uuid[];
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into n from public.notifications where id = p_id;
  if not found then return null; end if;
  v_perfiles := coalesce(n.user_ids, '{}') || coalesce((select array_agg(p.id) from public.profiles p where p.active and p.role_id = any (coalesce(n.roles, '{}'))), '{}');
  if coalesce(array_length(v_perfiles, 1), 0) = 0 then return null; end if;
  return jsonb_build_object('perfiles', to_jsonb(v_perfiles), 'kind', n.kind, 'body', n.body, 'conversation_id', n.conversation_id,
    'title', case n.kind when 'handoff_asignado' then '🔔 Cliente esperando' when 'retoma' then '🔔 Tu cliente volvió a escribir'
                         when 'cliente_escribe' then '💬 Tu cliente está escribiendo' when 'handoff_escalado' then '⚠️ Cliente sin atender'
                         when 'handoff_sin_vendedor' then '⚠️ Solicitud sin vendedor' when 'handoff_aviso' then '⏰ Cliente esperando'
                         when 'senal_compra' then '🛒 Señal de compra' when 'verificacion_wa' then '🪪 Verificar a un cliente'
                         when 'link_pago' then '💳 Te piden link de pago' else 'Renovacell' end);
end;
$$;
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind in ('handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe', 'senal_compra', 'verificacion_wa', 'link_pago'))
  execute function public._cc_aviso_push_tr();

do $g$ begin
  execute 'alter function public._lp_vendedor(uuid) owner to postgres';
  execute 'revoke all on function public._lp_vendedor(uuid), public._lp_avisar(uuid, text, text, text), public._lp_json(public.pago_links), public._lp_solicitar(uuid, text, uuid), public.cc_ia_link_pago(uuid, uuid, text), public.link_pago_solicitar(uuid), public.link_pago_enviar(uuid, text), public.link_pago_cancelar(uuid, text), public.link_pago_pagado(uuid, text), public.links_pago_lista(), public.link_pago_de_pedido(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.cc_ia_link_pago(uuid, uuid, text) to service_role';
  execute 'grant execute on function public.link_pago_solicitar(uuid), public.link_pago_enviar(uuid, text), public.link_pago_cancelar(uuid, text), public.link_pago_pagado(uuid, text), public.links_pago_lista(), public.link_pago_de_pedido(uuid) to authenticated';
end $g$;
