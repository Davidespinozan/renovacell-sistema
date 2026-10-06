-- ============================================================================
-- CC-6 · CHECKOUT CANÓNICO: carrito activo → revalidación server-side → pedido W1 (crear_pedido).
--
-- Capa DELGADA sobre CC-5 (carrito) + W1 (crear_pedido: precio por precio_de, items, estado
-- pending_payment) + W2 (verdad de pago: v_order_money). NO hay segundo motor de pedidos, ni
-- de precios, ni reserva de stock, ni escritura de pagos, ni CFDI.
--
-- Autoridad: `cc_checkout_revisar` y `cc_checkout_confirmar` corren como el DUEÑO AUTENTICADO
-- (auth.uid()); así la autorización nativa de crear_pedido (auth_role()='doctor' + is_verified())
-- se aplica sin envolverla ni debilitarla. El visitante no confirma: se registra (D-CC6-05).
--
-- Revisión = evidencia de lo que el usuario vio (huella de productos+cantidades+precios, total,
-- rev del carrito, vence en 15 min — D-CC6-01). NO es autoridad de precio: confirmar recalcula
-- todo y, si cambió, rechaza (CARRITO_CAMBIO / PRECIO_CAMBIO / SIN_DISPONIBILIDAD) y pide revisar
-- de nuevo. Un carrito se convierte una sola vez (lock + estado + libro de operaciones) y todo
-- ocurre en UNA transacción: o hay pedido Y carrito convertido Y revisión consumida, o nada.
--
-- Rollback: supabase/rollback/cc6/99_down.sql.
-- ============================================================================

do $pre$
begin
  if to_regclass('public.cc_carts') is null or to_regprocedure('public.cc_carrito_preparar_checkout(uuid,text,text,uuid)') is null then raise exception 'CC6: falta CC-5'; end if;
  if to_regprocedure('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)') is null then raise exception 'CC6: falta crear_pedido (W1)'; end if;
  if to_regprocedure('public.cc_ia_precio(uuid,uuid,int)') is null or to_regprocedure('public.cc_ia_disponibilidad(uuid,uuid)') is null then raise exception 'CC6: falta CC-4'; end if;
  if to_regclass('public.doctor_locations') is null then raise exception 'CC6: falta doctor_locations'; end if;
  if to_regprocedure('public.siguiente_folio()') is null then raise exception 'CC6: falta el folio del servidor (20261031130000)'; end if;
  if to_regclass('public.cc_checkout_reviews') is not null then raise exception 'CC6: ya aplicada'; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) TABLAS
-- ---------------------------------------------------------------------------
create table public.cc_checkout_reviews (
  id           uuid primary key default gen_random_uuid(),
  cart_id      uuid not null references public.cc_carts(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  cart_rev     int  not null,
  fingerprint  text not null,          -- huella de (product_id, qty, precio_unitario) ordenados: evidencia, no autoridad
  total        numeric not null,
  currency     text not null default 'MXN',
  n_items      int  not null,
  location_id  uuid references public.doctor_locations(id) on delete set null,
  direccion    jsonb,                  -- snapshot de entrega (forma ShippingAddress del portal)
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  order_id     uuid references public.orders(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint ck_ccr_consumo check ((consumed_at is null) = (order_id is null))
);
create index idx_ccr_cart on public.cc_checkout_reviews (cart_id, created_at desc);

create table public.cc_checkout_operations (
  cart_id       uuid not null references public.cc_carts(id) on delete cascade,
  operation_id  text not null,
  profile_id    uuid not null,
  review_id     uuid not null,
  status        text not null default 'completed',
  order_id      uuid references public.orders(id) on delete set null,
  resultado     jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (cart_id, operation_id),
  constraint ck_ccop_status check (status in ('completed')),   -- la conversión es atómica: no existe "processing" durable
  constraint ck_ccop_id check (length(operation_id) between 1 and 120)
);

create table public.cc_checkout_events (
  id          bigint generated always as identity primary key,
  cart_id     uuid not null references public.cc_carts(id) on delete cascade,
  review_id   uuid,
  profile_id  uuid,
  tipo        text not null,
  detalle     jsonb,
  created_at  timestamptz not null default now(),
  constraint ck_cce_tipo check (tipo in ('review_created', 'review_not_ready', 'confirmation_attempted', 'order_created', 'cart_converted',
                                        'confirmation_rejected_changed_cart', 'confirmation_rejected_price_changed', 'confirmation_rejected_stock',
                                        'confirmation_rejected_expired', 'confirmation_rejected_consumed', 'confirmation_rejected_product')),
  constraint ck_cce_detalle check (detalle is null or length(detalle::text) <= 1000)
);
create index idx_cce_cart on public.cc_checkout_events (cart_id, created_at);
create trigger trg_cce_append_only before update or delete on public.cc_checkout_events for each row execute function public._cc_append_only();

alter table public.cc_checkout_reviews enable row level security;
alter table public.cc_checkout_operations enable row level security;
alter table public.cc_checkout_events enable row level security;
revoke all on public.cc_checkout_reviews, public.cc_checkout_operations, public.cc_checkout_events from public, anon, authenticated;
grant select on public.cc_checkout_events to authenticated;
create policy cce_select_admin on public.cc_checkout_events for select to authenticated using (public.auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 2) HELPERS
-- ---------------------------------------------------------------------------
-- Las herramientas de CC-4 (cc_ia_contexto_actor / cc_ia_precio / cc_ia_disponibilidad) exigen
-- service_role porque las invoca el servidor. El checkout corre como el DUEÑO autenticado (para
-- que crear_pedido aplique su autorización nativa) y necesita esa misma autoridad de lectura.
-- Se extiende la guarda con una bandera INTERNA de transacción (`app.cc_interno`) que solo fijan
-- los comandos del servidor dentro de su propio cuerpo: un cliente PostgREST no puede fijar GUCs
-- arbitrarios (solo `request.*` desde cabeceras). Texto CC-4 + la bandera; el rollback lo restaura.
create or replace function public._cc_solo_servicio() returns void
  language plpgsql stable set search_path = public as
$$ begin if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' and coalesce(current_setting('app.cc_interno', true), '') <> 'on' then raise exception 'NO_AUTORIZADO: solo el servidor orquesta la IA' using errcode = 'insufficient_privilege'; end if; end $$;

create or replace function public._cc_chk_evento(p_cart uuid, p_review uuid, p_profile uuid, p_tipo text, p_detalle jsonb default null) returns void
  language sql set search_path = public as
$$ insert into public.cc_checkout_events (cart_id, review_id, profile_id, tipo, detalle) values (p_cart, p_review, p_profile, p_tipo, p_detalle) $$;

-- Líneas revalidadas con la autoridad actual del dueño. Devuelve {ok, lineas, total, fingerprint, problemas}.
-- La huella incluye precio unitario: si el precio cambia entre revisar y confirmar, la huella cambia.
create or replace function public._cc_chk_lineas(p_cart uuid, p_profile uuid) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare it record; pr jsonb; disp jsonb; lineas jsonb := '[]'::jsonb; problemas jsonb := '[]'::jsonb; total numeric := 0; huella text := ''; n int := 0;
begin
  for it in select i.product_id, i.quantity, p.name, p.active, p.sellable, p.show_portal, p.show_landing
              from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart order by i.product_id loop
    n := n + 1;
    if not it.active or not it.sellable or not (it.show_portal or it.show_landing) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'NO_VENDIBLE'); continue; end if;
    if it.quantity < 1 or it.quantity > 999 then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'CANTIDAD_INVALIDA'); continue; end if;
    pr := public.cc_ia_precio(p_profile, it.product_id, it.quantity);
    if not coalesce((pr ->> 'autorizado')::boolean, false) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', coalesce(pr ->> 'motivo', 'SIN_PRECIO')); continue; end if;
    disp := public.cc_ia_disponibilidad(p_profile, it.product_id);
    if coalesce(disp ->> 'estado', '') <> 'disponible' then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'SIN_DISPONIBILIDAD'); end if;   -- D-CC6-04: bloquea todo
    lineas := lineas || jsonb_build_object('product_id', it.product_id, 'qty', it.quantity, 'nombre', it.name, 'precio_unitario', (pr ->> 'precio_unitario')::numeric, 'subtotal', (pr ->> 'total')::numeric);
    total := total + (pr ->> 'total')::numeric;
    huella := huella || it.product_id::text || ':' || it.quantity || ':' || (pr ->> 'precio_unitario') || ';';
  end loop;
  if n = 0 then problemas := problemas || '"CARRITO_VACIO"'::jsonb; end if;
  return jsonb_build_object('ok', jsonb_array_length(problemas) = 0, 'lineas', lineas, 'total', round(total, 2), 'fingerprint', md5(huella), 'problemas', problemas, 'n_items', n);
end;
$$;

-- Dirección de entrega: ubicación indicada (propia y activa) o la default activa del doctor. Snapshot con la forma del portal.
create or replace function public._cc_chk_direccion(p_profile uuid, p_location uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('location_id', l.id, 'address', jsonb_build_object(
           'line1', btrim(l.line1 || coalesce(' ' || l.exterior_number, '') || coalesce(' int. ' || l.interior_number, '')),
           'colonia', l.neighborhood, 'cp', l.postal_code, 'city', l.city, 'state', l.state, 'refs', l.reference_notes, 'phone', l.contact_phone),
           'nombre', l.name, 'contacto', l.contact_name)
    from public.doctor_locations l
   where l.doctor_id = p_profile and l.active and (l.id = p_location or (p_location is null and l.is_default))
   order by (l.id = p_location) desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- 3) REVISAR (lectura + registro de evidencia). Corre como el dueño autenticado.
-- ---------------------------------------------------------------------------
create or replace function public.cc_checkout_revisar(p_cart uuid, p_location_id uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); c record; prep jsonb; lin jsonb; dir jsonb; problemas jsonb; rv uuid; v_exp timestamptz; v_rol text := public.auth_role();
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_rol <> 'doctor' then raise exception 'NO_AUTORIZADO: el checkout es del doctor dueño (el personal usa su flujo de pedidos)' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_carts where id = p_cart;
  if not found or c.profile_id is distinct from v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  perform set_config('app.cc_interno', 'on', true);   -- autoridad de lectura CC-4 para este comando (dueño ya verificado arriba)
  if c.estado = 'converted' then return jsonb_build_object('listo', false, 'problemas', '["YA_CONVERTIDO"]'::jsonb, 'order_id', c.converted_order_id, 'cart_id', c.id); end if;
  if c.estado <> 'active' then return jsonb_build_object('listo', false, 'problemas', '["CARRITO_CERRADO"]'::jsonb, 'cart_id', c.id); end if;
  -- CC-5: proyección + problemas base (cuenta, verificación, vendible, precio, disponibilidad)
  prep := public.cc_carrito_preparar_checkout(p_cart, 'doctor', null, v_uid);
  problemas := prep -> 'problemas';
  lin := public._cc_chk_lineas(p_cart, v_uid);
  dir := public._cc_chk_direccion(v_uid, p_location_id);
  if dir is null then problemas := problemas || '"REQUIERE_DIRECCION"'::jsonb; end if;
  if (prep ->> 'listo')::boolean and (lin ->> 'ok')::boolean and dir is not null then
    v_exp := now() + interval '15 minutes';   -- D-CC6-01
    insert into public.cc_checkout_reviews (cart_id, profile_id, cart_rev, fingerprint, total, n_items, location_id, direccion, expires_at)
    values (c.id, v_uid, c.rev, lin ->> 'fingerprint', (lin ->> 'total')::numeric, (lin ->> 'n_items')::int, (dir ->> 'location_id')::uuid, dir -> 'address', v_exp) returning id into rv;
    perform public._cc_chk_evento(c.id, rv, v_uid, 'review_created', jsonb_build_object('rev', c.rev, 'n_items', lin ->> 'n_items'));
    return jsonb_build_object('listo', true, 'cart_id', c.id, 'cart_rev', c.rev, 'review_id', rv, 'expires_at', v_exp, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN',
                              'lineas', lin -> 'lineas', 'direccion', dir, 'proyeccion', prep -> 'proyeccion', 'problemas', '[]'::jsonb);
  end if;
  perform public._cc_chk_evento(c.id, null, v_uid, 'review_not_ready', jsonb_build_object('n', jsonb_array_length(problemas)));
  return jsonb_build_object('listo', false, 'cart_id', c.id, 'cart_rev', c.rev, 'problemas', problemas || coalesce(lin -> 'problemas', '[]'::jsonb), 'proyeccion', prep -> 'proyeccion', 'direccion', dir, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) CONFIRMAR (una transacción: revalida → crear_pedido → carrito converted → revisión consumida → operación).
-- ---------------------------------------------------------------------------
-- Atribución de vendedor derivada del SERVIDOR (metadata del pedido, compatible con el estimador de comisiones
-- que lee shipping_meta.seller = email). Precedencia: 1) asesor asignado/activo en una conversación abierta del
-- perfil (CC-2); 2) dueño de cartera del perfil (profiles.meta.seller_profile_id uuid o meta.owner email);
-- 3) ninguno. Nunca lo elige el cliente ni el modelo. NO crea obligación económica (D-15 sigue abierta).
create or replace function public._cc_chk_seller(p_profile uuid) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare v_id uuid; v_origen text; v_email text;
begin
  select cv.seller_profile_id into v_id from public.cc_conversations cv where cv.profile_id = p_profile and cv.estado = 'abierta' and cv.modo in ('human_assigned', 'human_active') and cv.seller_profile_id is not null order by cv.asesoria_asignada_at desc nulls last limit 1;
  if v_id is not null then v_origen := 'asesor_asignado';
  else
    select nullif(p.meta ->> 'seller_profile_id', '')::uuid into v_id from public.profiles p where p.id = p_profile;
    if v_id is null then select s.id into v_id from public.profiles p join public.profiles s on lower(s.email) = lower(p.meta ->> 'owner') where p.id = p_profile and p.meta ->> 'owner' is not null limit 1; end if;
    if v_id is not null then v_origen := 'dueno_cartera'; end if;
  end if;
  if v_id is null then return null; end if;
  select email into v_email from public.profiles where id = v_id;
  return jsonb_build_object('seller_profile_id', v_id, 'seller', v_email, 'seller_origen', v_origen);
end;
$$;

create or replace function public._cc_chk_resultado(p_order uuid, p_cart uuid, p_idem boolean) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('confirmado', true, 'idempotente', p_idem, 'cart_id', p_cart, 'order_id', o.id, 'folio', o.external_ref, 'status', o.status, 'total', o.total, 'moneda', coalesce(o.currency, 'MXN'),
           'estado_pago', coalesce(m.estado_pago, 'pending'), 'saldo', coalesce(m.saldo, o.total),
           'acciones_pago', jsonb_build_array('transferencia', 'tarjeta'),   -- métodos permitidos hoy (reportar transferencia / Stripe); la verdad de pago sigue en W2
           'created_at', o.created_at)
    from public.orders o left join public.v_order_money m on m.order_id = o.id where o.id = p_order
$$;

create or replace function public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev int default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); r public.cc_checkout_reviews%rowtype; c record; op record; lin jsonb; v_order uuid; meta jsonb; res jsonb; w1 jsonb; v_fallo text; v_seller jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_operation is null or p_operation !~ '^[A-Za-z0-9:_.-]{1,120}$' then raise exception 'OPERACION_INVALIDA' using errcode = 'check_violation'; end if;
  select * into r from public.cc_checkout_reviews where id = p_review for update;
  if not found or r.profile_id <> v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- un review_id conocido no da acceso
  select * into c from public.cc_carts where id = r.cart_id for update;
  if c.profile_id is distinct from v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  perform set_config('app.cc_interno', 'on', true);

  -- Libro de operaciones: misma operación → mismo resultado; mismo id con otra revisión → conflicto.
  select * into op from public.cc_checkout_operations where cart_id = c.id and operation_id = p_operation;
  if found then
    if op.review_id <> r.id then raise exception 'IDEMPOTENCIA_CONFLICTO' using errcode = 'unique_violation'; end if;
    return public._cc_chk_resultado(op.order_id, c.id, true);
  end if;
  -- Ya convertido (por otra operación/revisión): devolver el pedido existente, nunca crear otro.
  if c.estado = 'converted' then return public._cc_chk_resultado(c.converted_order_id, c.id, true) || jsonb_build_object('motivo', 'YA_CONVERTIDO'); end if;
  if c.estado <> 'active' then raise exception 'CARRITO_CERRADO: %', c.estado using errcode = 'check_violation'; end if;
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_attempted', jsonb_build_object('rev', c.rev));

  if r.consumed_at is not null then
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_consumed');
    return jsonb_build_object('confirmado', false, 'motivo', 'REVISION_CONSUMIDA', 'cart_id', c.id);
  end if;
  if r.expires_at < now() then
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_expired');
    return jsonb_build_object('confirmado', false, 'motivo', 'REVISION_EXPIRADA', 'cart_id', c.id);
  end if;
  if r.cart_rev <> c.rev or (p_expected_rev is not null and p_expected_rev <> c.rev) then   -- D-CC6-03: cualquier cambio del carrito invalida la revisión
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_changed_cart', jsonb_build_object('rev_revisada', r.cart_rev, 'rev_actual', c.rev));
    return jsonb_build_object('confirmado', false, 'motivo', 'CARRITO_CAMBIO', 'cart_id', c.id, 'cart_rev', c.rev, 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;

  -- Revalidación TOTAL con la autoridad actual (precio, visibilidad, cantidades, disponibilidad).
  lin := public._cc_chk_lineas(c.id, v_uid);
  if not (lin ->> 'ok')::boolean then
    perform public._cc_chk_evento(c.id, r.id, v_uid, case when lin -> 'problemas' @> '[{"problema":"SIN_DISPONIBILIDAD"}]' or (lin -> 'problemas')::text like '%SIN_DISPONIBILIDAD%' then 'confirmation_rejected_stock' else 'confirmation_rejected_product' end, jsonb_build_object('n', jsonb_array_length(lin -> 'problemas')));
    return jsonb_build_object('confirmado', false, 'motivo', 'NO_LISTO', 'problemas', lin -> 'problemas', 'cart_id', c.id, 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;
  if lin ->> 'fingerprint' <> r.fingerprint then   -- mismo rev ⇒ mismos productos/cantidades ⇒ cambió el precio (D-CC6-02: no se compra en silencio)
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_price_changed', jsonb_build_object('total_revisado', r.total, 'total_actual', (lin ->> 'total')::numeric));
    return jsonb_build_object('confirmado', false, 'motivo', 'PRECIO_CAMBIO', 'cart_id', c.id, 'total_revisado', r.total, 'total_actual', (lin ->> 'total')::numeric, 'lineas', lin -> 'lineas', 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;

  -- Inyección de fallos SOLO para pruebas (GUC de sesión; un cliente PostgREST no puede fijarlo).
  v_fallo := current_setting('app.cc_checkout_fallar', true);
  if v_fallo = 'antes_w1' then raise exception 'FALLO_INYECTADO: antes_w1'; end if;

  -- W1: el pedido canónico. Precio e items los pone crear_pedido (precio_de con la lista del doctor); folio del servidor.
  v_order := gen_random_uuid();
  -- Folio: lo genera crear_pedido (servidor, formato legacy S<n>, único). El origen va en metadata, no en el folio.
  -- Vendedor (D-15, metadata server-derived; NO es comisión ni autoridad económica): asesor asignado por CC-2 > dueño de cartera del perfil > ninguno.
  v_seller := public._cc_chk_seller(v_uid);
  meta := jsonb_build_object('placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'address', r.direccion, 'location_id', r.location_id, 'cart_id', c.id, 'checkout_review_id', r.id)
          || coalesce(v_seller, '{}'::jsonb);
  w1 := public.crear_pedido(v_order, null, v_uid, (select jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'qty', (l ->> 'qty')::int)) from jsonb_array_elements(lin -> 'lineas') l), meta, false, null);
  if coalesce((w1 ->> 'order_id')::uuid, v_order) <> v_order then raise exception 'W1_INCONSISTENTE'; end if;
  if v_fallo = 'despues_w1' then raise exception 'FALLO_INYECTADO: despues_w1'; end if;   -- prueba: nada queda a medias
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'order_created', jsonb_build_object('order_id', v_order, 'total', (w1 ->> 'total')::numeric));

  update public.cc_carts set estado = 'converted', converted_order_id = v_order, closed_at = now(), rev = rev + 1, updated_at = now(), last_activity_at = now() where id = c.id;
  perform public._cc_cart_evento(c.id, 'converted', 'doctor', v_uid, null, null, null, null, jsonb_build_object('order_id', v_order));
  update public.cc_checkout_reviews set consumed_at = now(), order_id = v_order where id = r.id;
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'cart_converted', jsonb_build_object('order_id', v_order));
  if v_fallo = 'antes_operacion' then raise exception 'FALLO_INYECTADO: antes_operacion'; end if;
  res := public._cc_chk_resultado(v_order, c.id, false);
  insert into public.cc_checkout_operations (cart_id, operation_id, profile_id, review_id, order_id, resultado) values (c.id, p_operation, v_uid, r.id, v_order, res);
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) PRIVILEGIOS: revisar/confirmar como el dueño autenticado; helpers internos cerrados.
-- ---------------------------------------------------------------------------
revoke all on function public.cc_checkout_revisar(uuid, uuid), public.cc_checkout_confirmar(uuid, text, int), public._cc_chk_lineas(uuid, uuid), public._cc_chk_direccion(uuid, uuid),
  public._cc_chk_evento(uuid, uuid, uuid, text, jsonb), public._cc_chk_resultado(uuid, uuid, boolean), public._cc_chk_seller(uuid) from public, anon, authenticated;
grant execute on function public.cc_checkout_revisar(uuid, uuid), public.cc_checkout_confirmar(uuid, text, int) to authenticated;

do $post$
begin
  if has_function_privilege('anon', 'public.cc_checkout_confirmar(uuid,text,int)', 'EXECUTE') or has_function_privilege('anon', 'public.cc_checkout_revisar(uuid,uuid)', 'EXECUTE') then raise exception 'CC6: anon con acceso al checkout'; end if;
  if has_function_privilege('authenticated', 'public._cc_chk_lineas(uuid,uuid)', 'EXECUTE') then raise exception 'CC6: helper expuesto'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('cc_checkout_reviews', 'cc_checkout_operations') and grantee in ('anon', 'authenticated')) then raise exception 'CC6: clientes con grants en revisiones/operaciones'; end if;
  if pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,int)'::regprocedure) !~ 'public\.crear_pedido\(' or pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,int)'::regprocedure) ~ 'insert into public\.orders' then raise exception 'CC6: el pedido debe nacer SOLO por crear_pedido'; end if;
  if pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,int)'::regprocedure) ~ 'payment_entries|registrar_cobro|set payment_status|lots\b' then raise exception 'CC6: el checkout no toca pagos ni inventario'; end if;
end $post$;
