-- ============================================================================
-- AVISOS DEL PEDIDO · corrección (27 nov 2026, mismo día). La primera versión buscaba los avisos de WhatsApp por el
-- identificador del pedido en su clave; el de «pago confirmado» lleva el identificador del PAGO, así que no aparecía
-- en la venta. Ahora un aviso de WhatsApp pertenece al pedido si es el espejo ('wa:' + clave) de un correo de ese
-- pedido, que es como nacen todos. Misma función, misma visibilidad, solo lectura.
-- Solo reemplaza una función. Rollback: volver a aplicar la definición de 20270408070000.
-- ============================================================================
do $pre$ begin
  if to_regprocedure('public.avisos_del_pedido(uuid)') is null then raise exception 'AVISOS-PEDIDO-2: falta la función base'; end if;
  if position('wa:pedido_recibido:' in pg_get_functiondef('public.avisos_del_pedido(uuid)'::regprocedure)) = 0 then raise exception 'AVISOS-PEDIDO-2: ya aplicada'; end if;
end $pre$;

create or replace function public.avisos_del_pedido(p_order uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_rol text := public.auth_role(); v_ok boolean;
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
         -- Cada aviso de WhatsApp es el espejo de un correo del buzón: su clave es 'wa:' + la del correo. Así entran también
         -- los que no llevan el pedido en la clave (el de pago lleva el identificador del PAGO).
         where a.event_key in (select 'wa:' || c2.event_key from public.comm_outbox c2 where c2.order_id = p_order)
      ) s), '[]'::jsonb);
end;
$function$;
