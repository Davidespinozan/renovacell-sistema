-- ENSAYO GO-LIVE (20270204) · down: devuelve el aviso de pedido nuevo y el saludo a su texto exacto anterior.
CREATE OR REPLACE FUNCTION public._aviso_pedido_nuevo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_seller uuid; v_txt text;
begin
  if new.status <> 'pending_payment' then return new; end if;
  v_seller := nullif(new.shipping_meta ->> 'seller_profile_id', '')::uuid;
  v_txt := format('Nuevo pedido %s · %s · por cobrar', coalesce(new.external_ref, 'sin folio'), to_char(coalesce(new.total, 0), 'FM$999,999,990.00'));
  perform public._cc_notificar('pedido_nuevo', null, null, array['admin'], v_txt, 'av_pagos', 'pedido_nuevo:' || new.id::text);
  if v_seller is not null then
    perform public._cc_notificar('pedido_nuevo', null, array[v_seller], null, v_txt, null, 'pedido_nuevo_vendedor:' || new.id::text);
  end if;
  return new;
exception when others then
  raise warning 'aviso de pedido nuevo no emitido: %', sqlerrm;   -- un aviso nunca tumba la venta
  return new;
end;
$function$

;
CREATE OR REPLACE FUNCTION public._cc_texto_saludo(p_nombre text, p_producto text, p_asignada boolean, p_asesora text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ select '¡Hola' || coalesce(', ' || nullif(btrim(p_nombre), ''), '') || '! 👋 '
     || case when nullif(btrim(p_producto), '') is not null
             then 'Veo que te interesa ' || btrim(p_producto) || '. ¿Te gustaría conocer sus características o necesitas alguna recomendación? '
             else 'Veo que estás armando tu pedido. ¿Te gustaría conocer las características de algún producto o necesitas alguna recomendación? ' end
     || case when p_asignada and nullif(btrim(p_asesora), '') is not null then btrim(p_asesora) || ', tu asesora, ya tiene tu solicitud. '
             when p_asignada then 'Tu asesora ya tiene tu solicitud. '
             else 'Ya registré tu solicitud con nuestro equipo comercial. ' end
     || 'Mientras tanto, estoy aquí para ayudarte.' $function$

;
