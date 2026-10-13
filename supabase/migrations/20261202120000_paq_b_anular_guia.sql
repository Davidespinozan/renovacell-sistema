-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PAQ-B (migración 149) · ANULAR UNA GUÍA DE PAQUETERÍA Y DEJAR EL PEDIDO LISTO PARA OTRA
--   Hasta hoy una guía equivocada (dirección, medidas) no tenía salida: el pedido quedaba "enviado" con esa guía y la
--   base impide dos guías por pedido. La paquetería no ofrece anular por API (una guía sin usar no se entrega).
--   · anular_guia(op, pedido, motivo)   NUEVA. Dirección, Almacén o Empaque. Solo si el paquete sigue en el local:
--       pedido en "enviado", guía de paquetería (no chofer), sin recolección agendada y sin movimiento reportado por
--       la paquetería. Deja: intento = anulado; envío = cancelado, con su número en provider_meta.anulada y sin número
--       activo; pedido = empacado, sin datos de la guía; el aviso al cliente con el número anulado, si no había salido,
--       ya no sale. Idempotente por op_id. No toca inventario ni dinero.
--   · _comm_tr_orders   un cambio: si al pedido ya se le anuló una guía, el aviso "va en camino" de la guía NUEVA usa
--       su propia llave (…:r<n>) para que el cliente reciba el número vigente. Sin anulaciones, la llave de siempre.
--   NO cambia: orders_guard, shipments_guard, finalize_shipment, cancelar_pedido, anular_guia_manual, tablas, RLS.
--   Depende de la 148 (rastreo). Aplicar en UNA transacción. Rollback: supabase/rollback/paq_b/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'anular_guia') then raise exception 'PAQ-B: ya aplicada'; end if;
  if to_regclass('public.shipment_tracking') is null then raise exception 'PAQ-B: falta PAQ-A (148): aplícala antes'; end if;
  if md5(pg_get_functiondef('public._comm_tr_orders()'::regprocedure)) <> '6cd538f276621d538be34a2da15c4290' then
    raise exception 'PAQ-B: _comm_tr_orders no es la versión auditada';
  end if;
  -- Los candados y comandos en los que se apoya, tal como se auditaron.
  if md5(pg_get_functiondef('public.orders_guard()'::regprocedure)) <> 'e88f1bb21a69f79a1d31585cbc75bf7d'
     or md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) <> 'b1e791b99ca8043cb1e2913e0b294600'
     or md5(pg_get_functiondef('public.finalize_shipment(uuid,jsonb)'::regprocedure)) <> 'a1cf5c01877e87f41ee0e9635b478e34' then
    raise exception 'PAQ-B: orders_guard / shipments_guard / finalize_shipment no son las versiones auditadas';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and pg_get_constraintdef(oid) like '%anulacion_guia%')
     or not exists (select 1 from pg_constraint where conrelid = 'public.shipping_attempts'::regclass and pg_get_constraintdef(oid) like '%voided_manual%') then
    raise exception 'PAQ-B: faltan el tipo de operación anulacion_guia o el estado voided_manual';
  end if;
end $pre$;

create function public.anular_guia(p_op_id uuid, p_order uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- PAQ-B · Anula la guía de paquetería de un pedido que AÚN NO sale del local y lo deja listo para generar otra.
-- La paquetería no ofrece anular por API: una guía sin usar simplemente no se entrega. Aquí se deja constancia y se
-- libera el pedido. No toca inventario ni dinero (el pedido ya estaba surtido y, en su caso, cobrado).
declare
  v_rol text := public.auth_role(); v_uid uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_req jsonb; v_prev jsonb; v_res jsonb; o record; s public.shipments; v_estado text;
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
begin
  if v_rol is null or v_rol not in ('admin', 'warehouse', 'packing') then
    raise exception 'NO_AUTORIZADO: solo Dirección, Almacén o Empaque anulan una guía';
  end if;
  v_req := jsonb_build_object('order', p_order, 'motivo', v_motivo);
  v_prev := public._w1_op_begin(p_op_id, 'anulacion_guia', v_req);
  if v_prev is not null then return v_prev; end if;
  if v_motivo is null or length(v_motivo) < 3 or length(v_motivo) > 200 then
    raise exception 'MOTIVO_REQUERIDO: indica por qué se anula la guía (3 a 200 caracteres)';
  end if;

  select id, status, external_ref into o from public.orders where id = p_order for update;   -- una anulación a la vez por pedido
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.status <> 'shipped' then
    raise exception 'PEDIDO_NO_ENVIADO: solo se anula la guía de un pedido marcado como enviado (este está %)', o.status;
  end if;
  select * into s from public.shipments where order_id = p_order and tracking_number is not null for update;
  if not found then raise exception 'SIN_GUIA: ese pedido no tiene una guía de paquetería'; end if;
  if s.driver_id is not null then raise exception 'ENVIO_CON_CHOFER: ese envío lo lleva un chofer propio; no es una guía de paquetería'; end if;
  if s.status in ('delivered', 'cancelado') then raise exception 'ENVIO_CERRADO: ese envío ya está %', s.status; end if;
  if nullif(btrim(coalesce(s.pickup_confirmation, '')), '') is not null then
    raise exception 'RECOLECCION_AGENDADA: cancela primero la recolección agendada con la paquetería';
  end if;
  -- El paquete debe seguir en el local: si la paquetería ya reporta cualquier movimiento, lo que procede es una devolución.
  select t.estado into v_estado from public.shipment_tracking t where t.shipment_id = s.id;
  if v_estado is not null and v_estado <> 'sin_eventos' then
    raise exception 'PAQUETE_EN_PAQUETERIA: la paquetería ya reporta movimiento (%); no se anula la guía, registra una devolución', v_estado;
  end if;
  if exists (select 1 from public.shipping_attempts a where a.order_id = p_order and a.status in ('pending', 'unknown_requires_reconciliation')) then
    raise exception 'GUIA_EN_PROCESO: hay una guía en creación o en estado desconocido para este pedido; no se anula hasta resolverla';
  end if;

  update public.shipping_attempts
     set status = 'voided_manual', voided_by = v_uid, voided_at = now(),
         void_reference = left('Anulada en el sistema: ' || v_motivo, 240), updated_at = now()
   where order_id = p_order and status = 'succeeded';

  -- El envío queda como constancia: cancelado, con su número en `provider_meta.anulada` y SIN número activo (así el
  -- pedido admite una guía nueva y nada vuelve a tratar la anulada como vigente).
  update public.shipments
     set status = 'cancelado', tracking_number = null,
         provider_meta = coalesce(provider_meta, '{}'::jsonb) || jsonb_build_object('anulada',
           jsonb_build_object('tracking', s.tracking_number, 'motivo', v_motivo, 'por', v_uid, 'at', now()))
   where id = s.id;

  -- El pedido vuelve a "empacado" (transición que solo hace el servidor) y pierde los datos de la guía anulada.
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set status = 'packed',
         shipping_meta = coalesce(shipping_meta, '{}'::jsonb) - 'carrier' - 'tracking' - 'label_url' - 'method'
   where id = p_order;
  -- El aviso "tu pedido va en camino" con el número anulado, si aún no salió, ya no debe salir.
  update public.comm_outbox
     set status = 'fallido', last_error = left('GUIA_ANULADA: la guía ' || s.tracking_number || ' de este aviso se anuló, no reenviar', 300)
   where order_id = p_order and plantilla = 'pedido_enviado' and status = 'pendiente';
  perform set_config('app.trusted', v_trusted, true);

  begin
    perform public.log_audit('Guía anulada', coalesce(o.external_ref, p_order::text), 'guía ' || s.tracking_number || ' · ' || v_motivo, 'Logística');
  exception when others then null;   -- la bitácora de aplicación nunca bloquea la operación
  end;

  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'guia_anulada', s.tracking_number, 'order_status', 'packed');
  return public._w1_op_finish(p_op_id, 'anulacion_guia', v_req, v_res);
end;
$$;

alter function public.anular_guia(uuid, uuid, text) owner to postgres;
comment on function public.anular_guia(uuid, uuid, text) is 'PAQ-B · Anula la guía de paquetería de un pedido que no ha salido del local y lo regresa a empacado para generar otra. Logística. No toca inventario ni dinero.';
revoke all on function public.anular_guia(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.anular_guia(uuid, uuid, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public._comm_tr_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_reenvio int;
begin
  if tg_op = 'INSERT' then
    -- Solo el pedido que queda esperando pago. La venta de mostrador nace pagada y
    -- entregada: su comprobante es el recibo, no un correo de "recibimos tu pedido".
    if new.status = 'pending_payment' then
      perform public._comm_encolar('pedido_recibido:' || new.id, 'pedido_recibido', new.id,
        jsonb_build_object('total', new.total));
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'shipped' then
      -- PAQ-B · si a este pedido se le anuló una guía antes, este es OTRO hecho (sale con otra guía): lleva su propia
      -- llave para que el cliente reciba el aviso con el número de rastreo vigente. Sin anulaciones, la llave de siempre.
      select count(*) into v_reenvio from public.shipments s where s.order_id = new.id and s.status = 'cancelado' and s.provider_meta ? 'anulada';
      perform public._comm_encolar('pedido_enviado:' || new.id || case when v_reenvio > 0 then ':r' || v_reenvio else '' end, 'pedido_enviado', new.id,
        jsonb_build_object(
          'paqueteria', new.shipping_meta ->> 'carrier',
          'rastreo',    new.shipping_meta ->> 'tracking',
          'metodo',     new.shipping_meta ->> 'method'));
    elsif new.status = 'delivered' and old.status = 'shipped' then
      perform public._comm_encolar('pedido_entregado:' || new.id, 'pedido_entregado', new.id, '{}'::jsonb);
    elsif new.status = 'cancelled' then
      perform public._comm_encolar('pedido_cancelado:' || new.id, 'pedido_cancelado', new.id, '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$function$;

do $post$ begin
  if md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) <> '35015b5940b8848f001e18ce8d6e1356'
     or md5(pg_get_functiondef('public._comm_tr_orders()'::regprocedure)) <> 'f6cad9db69196400c9c69685ab7f5580' then
    raise exception 'PAQ-B: las funciones no quedaron con la definición esperada';
  end if;
  if has_function_privilege('anon', 'public.anular_guia(uuid,uuid,text)', 'execute') or not has_function_privilege('authenticated', 'public.anular_guia(uuid,uuid,text)', 'execute')
     or (select not prosecdef or proconfig is distinct from array['search_path=public'] or proowner <> 'postgres'::regrole from pg_proc where oid = 'public.anular_guia(uuid,uuid,text)'::regprocedure) then
    raise exception 'PAQ-B: forma o permisos de anular_guia inesperados';
  end if;
  if md5(pg_get_functiondef('public.orders_guard()'::regprocedure)) <> 'e88f1bb21a69f79a1d31585cbc75bf7d'
     or md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) <> 'b1e791b99ca8043cb1e2913e0b294600' then
    raise exception 'PAQ-B: los candados cambiaron';
  end if;
end $post$;
