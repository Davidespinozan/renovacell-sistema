-- ============================================================================
-- ADOPCIÓN DEL PORTAL (2 nov 2026, dueño: "el chiste es propiciar que los usuarios empiecen a usar el sistema también").
-- WhatsApp es la puerta de entrada; el portal, la casa. Sin quitarle nada a la atención por WhatsApp:
--   · al aprobar la verificación se le manda SU acceso (enlace para crear su contraseña; la Edge lo genera) y para qué le
--     sirve; si ya era cliente con ficha, se liga a ESA ficha (y a su cuenta, si ya tenía) en vez de detenerse;
--   · cada pedido confirmado por WhatsApp lleva el enlace al portal (seguimiento, comprobante, volver a pedir);
--   · adopcion_resumen: cuántos clientes ya usan su cuenta y por dónde llegan los pedidos (portal, WhatsApp, vendedor).
-- ============================================================================
drop function if exists public.cc_alta_wa_cerrar(uuid, uuid, uuid, uuid);
create or replace function public.cc_alta_wa_cerrar(p_solicitud uuid, p_customer uuid, p_profile uuid, p_actor uuid, p_enlace text default null, p_cuenta_nueva boolean default true) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_solicitudes_alta; v_wa text; v_nombre text; v_t text; v_seq bigint;
begin
  perform public._cc_solo_servicio();
  select * into s from public.cc_solicitudes_alta where id = p_solicitud for update;
  if not found or s.estado <> 'pendiente' then raise exception 'SOLICITUD_NO_PENDIENTE' using errcode = 'check_violation'; end if;
  update public.cc_solicitudes_alta set estado = 'aprobada', customer_id = p_customer, profile_id = p_profile, resuelta_por = p_actor, resuelta_at = now(), updated_at = now() where id = s.id;
  v_wa := (public._cc_wa_contacto_de(s.conversation_id)).wa_id;
  if v_wa is not null and p_profile is not null then
    update public.cc_wa_contactos set vinculo_profile_id = p_profile, vinculado_at = now(), vinculado_via = 'personal', vinculado_por = p_actor where wa_id = v_wa;
  end if;
  v_nombre := public._cc_primer_nombre(s.nombre);
  v_t := '¡Listo' || coalesce(', ' || v_nombre, '') || '! Ya quedaste verificado(a) en Renovacell. Desde ahora te doy tus precios, te cotizo y armamos tu pedido por aquí mismo.'
      || E'\n\n' || 'Además ya tienes tu portal, donde ves tus precios y promociones, el seguimiento de tus pedidos y vuelves a pedir con un toque: '
      || case when p_enlace is not null and p_cuenta_nueva then 'crea tu contraseña aquí ' || p_enlace || ' (el enlace vale una hora; si vence, entra a sistema.renovacell.mx y toca "¿Olvidaste tu contraseña?" con tu correo ' || s.email || ').'
              when p_cuenta_nueva then 'entra a sistema.renovacell.mx y toca "¿Olvidaste tu contraseña?" con tu correo ' || s.email || ' para crear tu contraseña.'
              else 'entra a sistema.renovacell.mx con tu cuenta de siempre.' end
      || E'\n\n' || '¿Te cotizo lo que me pediste?';
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = s.conversation_id returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (s.conversation_id, v_seq, 'ai', 'tpl:alta_wa:' || s.id, v_t, md5(v_t)) on conflict do nothing;
  return jsonb_build_object('aprobada', true, 'vinculado', v_wa is not null and p_profile is not null);
end;
$$;

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
      'portal', jsonb_build_object('url', 'https://sistema.renovacell.mx/sistema', 'para', 'ver el seguimiento de este pedido, subir su comprobante y volver a pedir con un toque'),
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

-- ── Adopción: quién ya usa su cuenta y por dónde llegan los pedidos ──────────────────────────────
create or replace function public.adopcion_resumen(p_dias int default 30) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 365));
begin
  perform public._cc_exige_admin();
  return jsonb_build_object('dias', p_dias,
    'clientes', (select jsonb_build_object(
        'activos', count(*), 'con_cuenta', count(*) filter (where c.profile_id is not null),
        'entraron', count(*) filter (where (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz >= v_desde),
        'con_avisos', count(*) filter (where exists (select 1 from public.push_suscripciones s where s.activo and s.profile_id = c.profile_id)),
        'compraron_sin_cuenta', count(*) filter (where c.profile_id is null and exists (select 1 from public.orders o where o.customer_id = c.id and o.created_at >= v_desde and o.status <> 'cancelled')))
      from public.customers c left join auth.users u on u.id = c.profile_id where c.active),
    'pedidos', (select coalesce(jsonb_object_agg(canal, n), '{}'::jsonb) from (
        select case when exists (select 1 from public.cc_checkout_operations op where op.order_id = o.id and op.operation_id like 'wa:%') then 'whatsapp_ia'
                    when o.shipping_meta ->> 'source' = 'cc_checkout' then 'portal'
                    when o.shipping_meta ->> 'placed_by' ilike '%caja%' or o.shipping_meta ->> 'source' = 'pos' then 'caja'
                    else 'vendedor' end canal, count(*) n
          from public.orders o where o.created_at >= v_desde and o.status <> 'cancelled' group by 1) z),
    'verificados_por_whatsapp', (select count(*) from public.cc_solicitudes_alta where estado = 'aprobada' and resuelta_at >= v_desde));
end;
$$;

do $g$ begin
  execute 'revoke all on function public.cc_alta_wa_cerrar(uuid, uuid, uuid, uuid, text, boolean) from public, anon, authenticated';
  execute 'grant execute on function public.cc_alta_wa_cerrar(uuid, uuid, uuid, uuid, text, boolean) to service_role';
  execute 'revoke all on function public.adopcion_resumen(int) from public, anon';
  execute 'grant execute on function public.adopcion_resumen(int) to authenticated';
end $g$;
