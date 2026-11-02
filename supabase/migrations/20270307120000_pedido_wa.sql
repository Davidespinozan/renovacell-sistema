-- ============================================================================
-- PEDIDO COMPLETO POR WHATSAPP (2 nov 2026, dueño: "sí, end to end"). Con un doctor ya reconocido en WhatsApp (vínculo
-- explícito, cc_ia_identidad_canal) la IA cierra la venta ahí mismo, por el MISMO checkout del portal y con sus reglas:
--   · su carrito es el de su cuenta (el mismo que ve en el portal);
--   · cc_ia_direccion_guardar: la dirección de entrega que dicta por el chat (queda en su perfil);
--   · cc_ia_pedido_revisar: revisión del checkout (precio, disponibilidad, entrega con flete y fecha prometida, horarios
--     de entrega local) — cc_checkout_revisar actuando como ese doctor;
--   · cc_ia_pedido_confirmar: confirma la revisión vigente — cc_checkout_confirmar actuando como ese doctor — y devuelve
--     folio, total y los datos para pagar. La IA solo la llama tras un "sí" explícito del doctor en su último mensaje
--     (lo exige el orquestador); el servidor exige que la revisión sea suya y siga vigente.
--   · Un comprobante (foto) que mande después con un pedido pendiente de pago le avisa al responsable para reportarlo.
-- "Actuar como" el doctor ocurre SOLO dentro de estas funciones de servidor y se revierte al terminar.
-- ============================================================================
create or replace function public._cc_actuar_como(p_profile uuid) returns void
  language sql set search_path = public as
$$ select set_config('request.jwt.claim.sub', coalesce(p_profile::text, ''), true),
          set_config('request.jwt.claims', case when p_profile is null then '{"role":"service_role"}' else jsonb_build_object('sub', p_profile, 'role', 'authenticated')::text end, true) $$;

create or replace function public._cc_ia_exige_identidad(p_conv uuid, p_profile uuid) returns void
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc_solo_servicio();
  if p_profile is null or public.cc_ia_identidad_canal(p_conv) is distinct from p_profile then
    raise exception 'NO_AUTORIZADO: ese WhatsApp no está vinculado a esa cuenta' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- El responsable comercial también se encuentra por el doctor VINCULADO al WhatsApp (su cartera), antes que el último asesor.
create or replace function public._cc_responsable_comercial(p_conv uuid) returns uuid
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    case when c.modo in ('human_assigned', 'human_active') then c.seller_profile_id end,
    case when c.profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(c.profile_id), false) then public._cc_vendedor_de(c.profile_id) end,
    (select public._cc_vendedor_de(w.vinculo_profile_id) from public.cc_wa_contactos w
      where w.wa_id = (public._cc_wa_contacto_de(c.id)).wa_id and w.vinculo_profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(w.vinculo_profile_id), false)),
    case when c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then public._cc_vendedor_de_cliente(c.customer_id) end,
    case when public._cc_vendedor_elegible(c.ultimo_asesor_id, false) then c.ultimo_asesor_id end)
  from public.cc_conversations c where c.id = p_conv
$$;

-- ── 1 · Dirección que dicta por el chat ──────────────────────────────────────────────────────────
create or replace function public.cc_ia_direccion_guardar(p_conv uuid, p_profile uuid, p_d jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_calle text := btrim(coalesce(p_d ->> 'calle', '')); v_num text := btrim(coalesce(p_d ->> 'numero', '')); v_col text := btrim(coalesce(p_d ->> 'colonia', ''));
  v_cp text := regexp_replace(coalesce(p_d ->> 'cp', ''), '\D', '', 'g'); v_ciudad text := btrim(coalesce(p_d ->> 'ciudad', '')); v_estado text := btrim(coalesce(p_d ->> 'estado', ''));
  v_id uuid; v_cu uuid;
begin
  perform public._cc_ia_exige_identidad(p_conv, p_profile);
  if char_length(v_calle) < 3 then return jsonb_build_object('guardada', false, 'campo', 'calle'); end if;
  if v_num = '' then return jsonb_build_object('guardada', false, 'campo', 'numero'); end if;
  if v_cp !~ '^[0-9]{5}$' then return jsonb_build_object('guardada', false, 'campo', 'cp'); end if;
  if char_length(v_ciudad) < 2 then return jsonb_build_object('guardada', false, 'campo', 'ciudad'); end if;
  if char_length(v_estado) < 2 then return jsonb_build_object('guardada', false, 'campo', 'estado'); end if;
  select id into v_cu from public.customers where profile_id = p_profile limit 1;
  update public.doctor_locations set is_default = false where doctor_id = p_profile and is_default;
  insert into public.doctor_locations (doctor_id, customer_id, name, line1, exterior_number, interior_number, neighborhood, postal_code, city, state, country, reference_notes, contact_name, contact_phone, is_default, active)
  values (p_profile, v_cu, left(coalesce(nullif(btrim(p_d ->> 'nombre'), ''), 'Entrega'), 80), left(v_calle, 200), left(v_num, 20), nullif(left(btrim(coalesce(p_d ->> 'interior', '')), 20), ''),
          nullif(left(v_col, 120), ''), v_cp, left(v_ciudad, 120), left(v_estado, 120), 'México', nullif(left(btrim(coalesce(p_d ->> 'referencias', '')), 300), ''),
          nullif(left(btrim(coalesce(p_d ->> 'recibe', '')), 120), ''), nullif(left(regexp_replace(coalesce(p_d ->> 'telefono', ''), '\D', '', 'g'), 15), ''), true, true)
  returning id into v_id;
  return jsonb_build_object('guardada', true, 'direccion', v_calle || ' ' || v_num || coalesce(', ' || nullif(v_col, ''), '') || ', CP ' || v_cp || ', ' || v_ciudad);
end;
$$;

-- ── 2 · Revisar el pedido (mismo checkout del portal) ────────────────────────────────────────────
create or replace function public.cc_ia_pedido_revisar(p_conv uuid, p_profile uuid, p_entrega text default null, p_horario jsonb default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_cart uuid; v_loc uuid; v_ent jsonb; r jsonb; v_dir text; v_h jsonb;
begin
  perform public._cc_ia_exige_identidad(p_conv, p_profile);
  v_cart := (public.cc_carrito_abrir('doctor', null, p_profile, null) ->> 'cart_id')::uuid;
  select id, line1 || ' ' || coalesce(exterior_number, '') || coalesce(', ' || neighborhood, '') || ', CP ' || postal_code || ', ' || city into v_loc, v_dir
    from public.doctor_locations where doctor_id = p_profile and active order by is_default desc, updated_at desc limit 1;
  if p_entrega is not null and p_entrega ~ '^[a-z_]{3,30}$' then
    v_ent := jsonb_build_object('opcion', p_entrega);
    if p_horario ? 'fecha' and p_horario ? 'inicio' then v_ent := v_ent || jsonb_build_object('horario', jsonb_build_object('fecha', p_horario ->> 'fecha', 'inicio', p_horario ->> 'inicio')); end if;
  end if;
  perform public._cc_actuar_como(p_profile);
  r := public.cc_checkout_revisar(v_cart, v_loc, null, v_ent);
  -- Entrega local por chofer: las primeras franjas libres para que el doctor elija (fecha + hora de inicio).
  if coalesce(r -> 'entrega_opciones' ->> 'local', 'false') = 'true' then
    v_h := (select coalesce(jsonb_agg(x) filter (where n <= 8), '[]'::jsonb) from (
              select jsonb_build_object('fecha', d ->> 'fecha', 'inicio', sl ->> 'inicio', 'fin', sl ->> 'fin') x, row_number() over (order by d ->> 'fecha', sl ->> 'inicio') n
                from jsonb_array_elements(coalesce(public.entrega_horarios_disponibles(now()) -> 'dias', '[]'::jsonb)) d, jsonb_array_elements(coalesce(d -> 'slots', '[]'::jsonb)) sl
               where (sl ->> 'disponible')::boolean) z);
  end if;
  perform public._cc_actuar_como(null);
  return r || jsonb_build_object('direccion_guardada', v_dir, 'horarios_entrega_local', v_h);
exception when others then
  perform public._cc_actuar_como(null);
  raise;
end;
$$;

-- ── 3 · Confirmar el pedido (tras el "sí" del doctor) ────────────────────────────────────────────
create or replace function public.cc_ia_pedido_confirmar(p_conv uuid, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_cart uuid; v_rev record; r jsonb; cs record; v_folio text; v_total numeric;
begin
  perform public._cc_ia_exige_identidad(p_conv, p_profile);
  v_cart := (public.cc_carrito_abrir('doctor', null, p_profile, null) ->> 'cart_id')::uuid;
  select id, cart_rev into v_rev from public.cc_checkout_reviews
   where cart_id = v_cart and profile_id = p_profile and consumed_at is null and expires_at > now() order by created_at desc limit 1;
  if v_rev.id is null then return jsonb_build_object('confirmado', false, 'motivo', 'SIN_REVISION_VIGENTE'); end if;
  perform public._cc_actuar_como(p_profile);
  r := public.cc_checkout_confirmar(v_rev.id, 'wa:' || v_rev.id, v_rev.cart_rev, false, null);
  perform public._cc_actuar_como(null);
  if coalesce((r ->> 'confirmado')::boolean, false) then
    select external_ref, total into v_folio, v_total from public.orders where id = (r ->> 'order_id')::uuid;
    select banco, clabe, cuenta, titular into cs from public.company_settings limit 1;
    r := r || jsonb_build_object('folio', v_folio, 'total', v_total,
      'pago', jsonb_build_object('banco', cs.banco, 'clabe', cs.clabe, 'cuenta', cs.cuenta, 'titular', cs.titular, 'referencia', v_folio,
                                 'instruccion', 'Transferencia con el folio como referencia; manda aquí la foto del comprobante.'));
    perform public._cc_avisar_responsable(p_conv, 'pedido_wa', public._cc_nombre_dueno(p_conv) || ' confirmó por WhatsApp el pedido ' || coalesce(v_folio, '') || ' (' || public._cc_dinero(v_total) || '); la IA le mandó los datos de pago.', 'pedido_wa:' || (r ->> 'order_id'));
  end if;
  return r;
exception when others then
  perform public._cc_actuar_como(null);
  raise;
end;
$$;

-- ── 4 · Una foto con pedido pendiente de pago → al responsable (posible comprobante) ──────────────
create or replace function public._cc_comprobante_wa_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_p uuid; v_folio text;
begin
  v_p := public.cc_ia_identidad_canal(new.conversation_id);
  if v_p is null then return new; end if;
  select external_ref into v_folio from public.orders where doctor_id = v_p and status <> 'cancelled' and payment_status <> 'paid' and created_at > now() - interval '14 days' order by created_at desc limit 1;
  if v_folio is null then return new; end if;
  perform public._cc_avisar_responsable(new.conversation_id, 'comprobante_wa', public._cc_nombre_dueno(new.conversation_id) || ' mandó una imagen por WhatsApp: puede ser el comprobante del pedido ' || v_folio || '. Revísalo y repórtalo desde su chat.', 'comprobante_wa:' || new.id);
  return new;
exception when others then
  raise warning 'COMPROBANTE_WA: % (la imagen se guardó)', sqlerrm;
  return new;
end;
$$;
drop trigger if exists cc_comprobante_wa on public.cc_adjuntos;
create trigger cc_comprobante_wa after insert on public.cc_adjuntos for each row execute function public._cc_comprobante_wa_tr();

-- Las alertas nuevas también suenan y llegan como push urgente.
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind in ('handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe', 'senal_compra', 'verificacion_wa', 'pedido_wa', 'comprobante_wa'))
  execute function public._cc_aviso_push_tr();

do $g$ begin
  execute 'revoke all on function public._cc_actuar_como(uuid), public._cc_ia_exige_identidad(uuid, uuid), public.cc_ia_direccion_guardar(uuid, uuid, jsonb), public.cc_ia_pedido_revisar(uuid, uuid, text, jsonb), public.cc_ia_pedido_confirmar(uuid, uuid), public._cc_comprobante_wa_tr() from public, anon, authenticated';
  execute 'grant execute on function public.cc_ia_direccion_guardar(uuid, uuid, jsonb), public.cc_ia_pedido_revisar(uuid, uuid, text, jsonb), public.cc_ia_pedido_confirmar(uuid, uuid) to service_role';
end $g$;
