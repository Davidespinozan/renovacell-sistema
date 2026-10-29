-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ENSAYO GO-LIVE (29 oct 2026) · hallazgos del recorrido completo de un día de operación en una copia local.
--   · _aviso_pedido_nuevo   el aviso "Nuevo pedido · por cobrar" llevaba a Dirección a "Pagos por validar", que está
--                           vacía mientras el cliente no informa un pago. Ahora lleva a Facturación (Por cobrar), donde
--                           se registra el cobro o se ve el saldo. Mismo texto, mismos destinatarios.
--   · _cc_texto_saludo      el saludo del asistente presentaba a cualquier vendedor como "tu asesora"; el equipo ya
--                           tiene vendedores hombres. Frase neutra: "<nombre>, de nuestro equipo comercial, ya tiene…".
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure)) <> 'b25cf35197e6fd43a35003bb75d728a9' then
    raise exception 'ENSAYO-GOLIVE: _aviso_pedido_nuevo cambió desde la auditoría; revisar antes de aplicar'; end if;
  if md5(pg_get_functiondef('public._cc_texto_saludo(text,text,boolean,text)'::regprocedure)) <> 'f5c98f12f0cbcb65b8e064927762651d' then
    raise exception 'ENSAYO-GOLIVE: _cc_texto_saludo cambió desde la auditoría; revisar antes de aplicar'; end if;
end $pre$;

create or replace function public._aviso_pedido_nuevo() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_seller uuid; v_txt text;
begin
  if new.status <> 'pending_payment' then return new; end if;
  v_seller := nullif(new.shipping_meta ->> 'seller_profile_id', '')::uuid;
  v_txt := format('Nuevo pedido %s · %s · por cobrar', coalesce(new.external_ref, 'sin folio'), to_char(coalesce(new.total, 0), 'FM$999,999,990.00'));
  perform public._cc_notificar('pedido_nuevo', null, null, array['admin'], v_txt, 'av_fin', 'pedido_nuevo:' || new.id::text);
  if v_seller is not null then
    perform public._cc_notificar('pedido_nuevo', null, array[v_seller], null, v_txt, null, 'pedido_nuevo_vendedor:' || new.id::text);
  end if;
  return new;
exception when others then
  raise warning 'aviso de pedido nuevo no emitido: %', sqlerrm;   -- un aviso nunca tumba la venta
  return new;
end;
$$;

create or replace function public._cc_texto_saludo(p_nombre text, p_producto text, p_asignada boolean, p_asesora text) returns text
  language sql immutable as
$$ select '¡Hola' || coalesce(', ' || nullif(btrim(p_nombre), ''), '') || '! 👋 '
     || case when nullif(btrim(p_producto), '') is not null
             then 'Veo que te interesa ' || btrim(p_producto) || '. ¿Te gustaría conocer sus características o necesitas alguna recomendación? '
             else 'Veo que estás armando tu pedido. ¿Te gustaría conocer las características de algún producto o necesitas alguna recomendación? ' end
     || case when p_asignada and nullif(btrim(p_asesora), '') is not null then btrim(p_asesora) || ', de nuestro equipo comercial, ya tiene tu solicitud. '
             when p_asignada then 'Nuestro equipo comercial ya tiene tu solicitud. '
             else 'Ya registré tu solicitud con nuestro equipo comercial. ' end
     || 'Mientras tanto, estoy aquí para ayudarte.' $$;

do $post$ begin
  if pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure) not like '%''av_fin''%' then raise exception 'ENSAYO-GOLIVE: aviso sin destino Facturación'; end if;
  if public._cc_texto_saludo('Ana', null, true, 'Roberto') like '%asesora%' then raise exception 'ENSAYO-GOLIVE: saludo aún en femenino fijo'; end if;
end $post$;
