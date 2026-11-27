-- ============================================================================
-- AVISOS DEL PEDIDO, A LA VISTA (27 nov 2026, dueño: «sí les llegan los mensajes por WhatsApp; lo que se me hace raro es
-- que en el sistema no hay manera de ver que se envió eso»).
--   Cada pedido ya manda avisos al cliente por correo (`comm_outbox`) y por WhatsApp (`cc_wa_avisos`): recibido, pago
--   confirmado, va en camino, entregado. Pero el personal no los veía: los correos solo los lee Dirección y los de
--   WhatsApp no tenían lectura para nadie. Esta función entrega, para UN pedido, qué avisos salieron, por qué canal,
--   cuándo, y si no salieron por qué.
--   · Solo lectura. No manda, no reintenta, no cambia nada.
--   · Lo ve el personal que YA puede ver ese pedido: es la misma condición de la política `orders_select_scoped` para
--     admin / almacén / empaque / facturación / ventas. A Ventas NO se le amplía nada: un pedido que no es de su cartera
--     devuelve vacío. Chofer y doctor no la usan (vacío).
--   · El destino va enmascarado (j•••@dominio, •••• 4391).
-- Solo crea una función (sin tablas ni índices). Rollback: drop function public.avisos_del_pedido(uuid);
-- ============================================================================
do $pre$ begin
  if to_regprocedure('public.avisos_del_pedido(uuid)') is not null then raise exception 'AVISOS-PEDIDO: ya aplicada'; end if;
  if to_regclass('public.cc_wa_avisos') is null or to_regclass('public.comm_outbox') is null
     or to_regprocedure('public.order_vendor_email(uuid)') is null or to_regprocedure('public._cx0c_venta_pos_propia(uuid)') is null then
    raise exception 'AVISOS-PEDIDO: faltan piezas previas (avisos de WhatsApp, buzón de correos o las reglas de Ventas)'; end if;
end $pre$;

create function public.avisos_del_pedido(p_order uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rol text := public.auth_role(); v_ok boolean; v_id text := p_order::text;
begin
  if auth.uid() is null or v_rol is null or p_order is null then return '[]'::jsonb; end if;
  -- Misma condición que `orders_select_scoped` para el personal: no se amplía lo que cada quien ya ve.
  select (v_rol in ('admin', 'warehouse', 'packing', 'billing')
          or (v_rol = 'pos' and ((o.shipping_meta ->> 'seller_profile_id') = auth.uid()::text
               or ((o.shipping_meta ->> 'seller_profile_id') is null and (o.shipping_meta ->> 'seller') = (auth.jwt() ->> 'email'))
               or public.order_vendor_email(o.id) = (auth.jwt() ->> 'email')
               or public._cx0c_venta_pos_propia(o.id)
               or (o.shipping_meta ->> 'placed_by_id') = auth.uid()::text)))
    into v_ok from public.orders o where o.id = p_order;
  if not coalesce(v_ok, false) then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(s.x order by s.cuando, s.canal)
      from (
        select coalesce(c.sent_at, c.created_at) cuando, 'correo' canal,
               jsonb_build_object('canal', 'correo', 'aviso', c.plantilla, 'estado', c.status, 'cuando', coalesce(c.sent_at, c.created_at),
                 'destino', case when c.to_address ~ '^[^@\s]+@[^@\s]+$' then left(c.to_address, 1) || '•••' || substring(c.to_address from '@.*$') end,
                 'respondio', false,
                 'detalle', case when c.status in ('fallido', 'incierto') then left(coalesce(c.last_error, ''), 160) end) x
          from public.comm_outbox c where c.order_id = p_order
        union all
        select coalesce(a.enviado_at, a.created_at), 'whatsapp',
               jsonb_build_object('canal', 'whatsapp', 'aviso', split_part(a.event_key, ':', 2), 'estado', a.estado, 'cuando', coalesce(a.enviado_at, a.created_at),
                 'destino', case when length(regexp_replace(coalesce(a.destino, ''), '\D', '', 'g')) >= 4 then '•••• ' || right(regexp_replace(a.destino, '\D', '', 'g'), 4) end,
                 'respondio', a.respondio_at is not null,
                 'detalle', case when a.estado in ('fallido', 'incierto', 'omitido') then left(coalesce(nullif(a.motivo, ''), a.error, ''), 160) end)
          from public.cc_wa_avisos a
         where a.event_key in ('wa:pedido_recibido:' || v_id, 'wa:pago_recibido:' || v_id, 'wa:pedido_enviado:' || v_id, 'wa:pedido_entregado:' || v_id,
                               'wa:pedido_cancelado:' || v_id, 'wa:reembolso_realizado:' || v_id)
      ) s), '[]'::jsonb);
end;
$function$;

revoke all on function public.avisos_del_pedido(uuid) from public, anon;
grant execute on function public.avisos_del_pedido(uuid) to authenticated, service_role;
comment on function public.avisos_del_pedido(uuid) is 'Avisos al cliente de un pedido (correo y WhatsApp): cuál, cuándo, estado. Solo lectura; misma visibilidad que el pedido.';
