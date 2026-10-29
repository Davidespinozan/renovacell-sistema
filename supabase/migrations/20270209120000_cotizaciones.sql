-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- COTIZACIONES (29 oct 2026) · bloque 3 del expediente del vendedor.
--   Dueño: "que el vendedor pueda hacer cotizaciones y mandarlas por WhatsApp o correo, y que quede registrado en el
--   expediente del cliente aunque todavía no tenga acceso a su portal".
--   · cotizaciones: folio C-<n>, cliente (ficha), conversación de origen, vendedor, renglones con precio CONGELADO al
--     cotizar (misma regla que un pedido: precio_de con la lista de su cuenta, o General sin cuenta; volumen incluido),
--     vigencia de 7 días (decisión del dueño), estado (enviada → convertida | cancelada; "vencida" se deduce por fecha).
--   · Se manda por el chat (el texto lo arma la app y sale por WhatsApp en la misma conversación) o por correo (buzón
--     comm_outbox, plantilla 'cotizacion'). Con un toque se convierte en pedido (Nuevo pedido con sus renglones) y queda
--     ligada al pedido. Los pedidos los sigue creando crear_pedido (precios del momento): la cotización no los reemplaza.
--   · Autoridad: Dirección o el vendedor de ese cliente (_c360_actor); el cliente con cuenta las lee.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
create sequence public.cotizacion_folio_seq start 1001;
create table public.cotizaciones (
  id                uuid primary key default gen_random_uuid(),
  folio             text not null unique default ('C-' || nextval('public.cotizacion_folio_seq')),
  customer_id       uuid not null references public.customers(id) on delete restrict,
  conversation_id   uuid references public.cc_conversations(id) on delete set null,
  seller_profile_id uuid references public.profiles(id) on delete set null,
  estado            text not null default 'enviada' check (estado in ('enviada', 'convertida', 'cancelada')),
  vigente_hasta     timestamptz not null,
  lineas            jsonb not null check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) between 1 and 60),
  subtotal          numeric(12,2) not null check (subtotal >= 0),
  total             numeric(12,2) not null check (total >= 0),
  notas             text check (notas is null or length(notas) <= 500),
  order_id          uuid references public.orders(id) on delete set null,
  enviada_chat_at   timestamptz,
  enviada_correo_at timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index ix_cot_customer on public.cotizaciones (customer_id, created_at desc);
alter table public.cotizaciones enable row level security;
revoke all on table public.cotizaciones from public, anon, authenticated;
grant select on table public.cotizaciones to authenticated;
grant select, insert, update on table public.cotizaciones to service_role;
-- Lectura: Dirección, el vendedor de ese cliente o el propio cliente con cuenta. Escritura solo por comandos.
create function public._cot_puede_leer(p_customer uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public._c360_actor(p_customer) in ('direccion', 'vendedor', 'dueno'), false) $$;
revoke all on function public._cot_puede_leer(uuid) from public, anon;
grant execute on function public._cot_puede_leer(uuid) to authenticated, service_role;
create policy cotizaciones_select on public.cotizaciones for select to authenticated using (public._cot_puede_leer(customer_id));

alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in (
  'pedido_recibido', 'pago_recibido', 'pedido_enviado', 'pedido_entregado', 'pedido_cancelado', 'reembolso_realizado',
  'registro_recibido', 'cuenta_verificada', 'verificacion_rechazada', 'promocion', 'cotizacion'));

create function public._cot_exige(p_customer uuid) returns text
  language plpgsql stable security definer set search_path = public as
$$ declare a text := public._c360_actor(p_customer);
begin
  if a is null or a not in ('direccion', 'vendedor') then raise exception 'NO_AUTORIZADO: solo Dirección o el vendedor del cliente' using errcode = 'insufficient_privilege'; end if;
  return a;
end $$;

-- ── Crear: precios del servidor, congelados ───────────────────────────────────────────────────────────
create function public.cc_cotizacion_crear(p_customer uuid, p_lineas jsonb, p_notas text default null, p_conversation uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare cu record; v_list uuid; l jsonb; pr record; q int; up numeric; v_lineas jsonb := '[]'::jsonb; v_sub numeric := 0; v_id uuid; r public.cotizaciones;
begin
  perform public._cot_exige(p_customer);
  select id, profile_id, active into cu from public.customers where id = p_customer;
  if not cu.active then raise exception 'CLIENTE_INACTIVO' using errcode = 'check_violation'; end if;
  if p_conversation is not null and not (public._cc_puede_ver_conv(p_conversation)
       and exists (select 1 from public.cc_conversations c where c.id = p_conversation and (c.customer_id = p_customer or (c.profile_id is not null and c.profile_id = cu.profile_id)))) then
    raise exception 'CONVERSACION_AJENA: la conversación no es de este cliente' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 60 then raise exception 'LINEAS_INVALIDAS' using errcode = 'check_violation'; end if;
  v_list := (select p.price_list_id from public.profiles p where p.id = cu.profile_id);
  for l in select * from jsonb_array_elements(p_lineas) loop
    q := (l ->> 'qty')::int;
    if q is null or q < 1 or q > 999 then raise exception 'LINEAS_INVALIDAS: cantidad' using errcode = 'check_violation'; end if;
    select id, name, sku, price, active, sellable into pr from public.products where id = (l ->> 'product_id')::uuid;
    if not found or not coalesce(pr.active, false) or pr.sellable is false or pr.price is null then raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(pr.name, l ->> 'product_id') using errcode = 'check_violation'; end if;
    up := public.precio_de(pr.id, v_list, q);
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'nombre', pr.name, 'sku', pr.sku, 'qty', q, 'unit_price', up, 'precio_lista', pr.price, 'subtotal', round(up * q, 2)));
    v_sub := v_sub + round(up * q, 2);
  end loop;
  insert into public.cotizaciones (customer_id, conversation_id, seller_profile_id, vigente_hasta, lineas, subtotal, total, notas, created_by)
  values (p_customer, p_conversation, coalesce(public._cc_vendedor_de_cliente(p_customer), case when public.auth_role() = 'pos' then auth.uid() end),
          now() + interval '7 days', v_lineas, v_sub, v_sub, nullif(btrim(coalesce(p_notas, '')), ''), auth.uid())
  returning * into r;
  return to_jsonb(r);
end;
$$;

-- ── Enviar por correo / marcar enviada por el chat ────────────────────────────────────────────────────
create function public.cc_cotizacion_enviar(p_cot uuid, p_via text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cotizaciones; cu record; v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_mail text; v_vend text;
begin
  select * into r from public.cotizaciones where id = p_cot for update;
  if not found then raise exception 'COTIZACION_INEXISTENTE' using errcode = 'check_violation'; end if;
  perform public._cot_exige(r.customer_id);
  if r.estado <> 'enviada' or r.vigente_hasta < now() then raise exception 'COTIZACION_NO_VIGENTE' using errcode = 'check_violation'; end if;
  if p_via = 'chat' then
    update public.cotizaciones set enviada_chat_at = now(), updated_at = now() where id = p_cot;
    return jsonb_build_object('via', 'chat');
  elsif p_via <> 'correo' then raise exception 'VIA_INVALIDA' using errcode = 'check_violation';
  end if;
  select c.full_name, c.email, c.profile_id into cu from public.customers c where c.id = r.customer_id;
  v_mail := nullif(lower(btrim(coalesce(cu.email, (select p.email from public.profiles p where p.id = cu.profile_id), ''))), '');
  if v_mail is null then raise exception 'SIN_CORREO: el cliente no tiene correo en su ficha' using errcode = 'check_violation'; end if;
  v_vend := (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = r.seller_profile_id);
  perform set_config('app.trusted', 'on', true);
  insert into public.comm_outbox (event_key, plantilla, customer_id, profile_id, to_address, to_name, payload, status)
  values ('cotizacion:' || p_cot || ':' || extract(epoch from clock_timestamp())::bigint, 'cotizacion', r.customer_id, cu.profile_id, v_mail, cu.full_name,
          jsonb_build_object('folio', r.folio, 'total', r.total, 'vigente_hasta', r.vigente_hasta, 'notas', r.notas, 'vendedor', v_vend,
            'lineas', (select jsonb_agg(jsonb_build_object('nombre', x ->> 'nombre', 'qty', (x ->> 'qty')::int, 'unit_price', (x ->> 'unit_price')::numeric, 'subtotal', (x ->> 'subtotal')::numeric)) from jsonb_array_elements(r.lineas) x)),
          'pendiente');
  perform set_config('app.trusted', v_trusted, true);
  update public.cotizaciones set enviada_correo_at = now(), updated_at = now() where id = p_cot;
  return jsonb_build_object('via', 'correo', 'para', regexp_replace(v_mail, '^(.).*(@.*)$', '\1•••\2'));
end;
$$;

-- ── Convertida en pedido / cancelada ──────────────────────────────────────────────────────────────────
create function public.cc_cotizacion_convertida(p_cot uuid, p_order uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cotizaciones;
begin
  select * into r from public.cotizaciones where id = p_cot for update;
  if not found then raise exception 'COTIZACION_INEXISTENTE' using errcode = 'check_violation'; end if;
  perform public._cot_exige(r.customer_id);
  if r.estado = 'convertida' and r.order_id = p_order then return jsonb_build_object('idempotente', true); end if;
  if r.estado <> 'enviada' then raise exception 'COTIZACION_NO_VIGENTE' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.orders o where o.id = p_order and o.customer_id = r.customer_id) then raise exception 'PEDIDO_AJENO: el pedido no es de este cliente' using errcode = 'check_violation'; end if;
  update public.cotizaciones set estado = 'convertida', order_id = p_order, updated_at = now() where id = p_cot;
  return jsonb_build_object('idempotente', false);
end;
$$;
create function public.cc_cotizacion_cancelar(p_cot uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cotizaciones;
begin
  select * into r from public.cotizaciones where id = p_cot for update;
  if not found then raise exception 'COTIZACION_INEXISTENTE' using errcode = 'check_violation'; end if;
  perform public._cot_exige(r.customer_id);
  if r.estado = 'cancelada' then return jsonb_build_object('idempotente', true); end if;
  if r.estado <> 'enviada' then raise exception 'COTIZACION_NO_VIGENTE' using errcode = 'check_violation'; end if;
  update public.cotizaciones set estado = 'cancelada', updated_at = now() where id = p_cot;
  return jsonb_build_object('idempotente', false);
end;
$$;

revoke all on function public._cot_exige(uuid), public.cc_cotizacion_crear(uuid, jsonb, text, uuid), public.cc_cotizacion_enviar(uuid, text),
  public.cc_cotizacion_convertida(uuid, uuid), public.cc_cotizacion_cancelar(uuid) from public, anon;
grant execute on function public._cot_exige(uuid), public.cc_cotizacion_crear(uuid, jsonb, text, uuid), public.cc_cotizacion_enviar(uuid, text),
  public.cc_cotizacion_convertida(uuid, uuid), public.cc_cotizacion_cancelar(uuid) to authenticated, service_role;
