-- REVISIÓN INDEPENDIENTE (19 nov 2026) · ajustes a lo publicado hoy.
--   1. Regla F-9 («el dinero que llegó se registra SIEMPRE»): un link ENVIADO de un pedido que luego se cancela ya no se
--      cancela solo; se puede marcar «Ya pagó» y el cobro queda como excepción (sobre pedido cancelado), como todo cobro.
--      Lo que SÍ se cancela solo es la SOLICITUD aún no enviada. Mandar el link de un pedido cancelado sigue bloqueado.
--   2. Sin doble cobro: si el pedido ya quedó pagado (p. ej. el chofer cobró al entregar), «Ya pagó» del link se rechaza.
--   3. Retomar: el aviso dice «se le asignó a X» cuando aún no la atiende (antes decía «la está atendiendo ahora»).
do $pre$ begin
  if position('if (select x.status from public.orders x where x.id = l.order_id) = ''cancelled'' then raise exception ''PEDIDO_CANCELADO: ese pedido está cancelado; no se registra el cobro''' in pg_get_functiondef('public.link_pago_pagado(uuid,text)'::regprocedure)) = 0 then
    raise exception 'REVISION: link_pago_pagado cambió'; end if;
end $pre$;

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.link_pago_pagado(uuid,text)'::regprocedure);
  execute replace(d,
    'if (select x.status from public.orders x where x.id = l.order_id) = ''cancelled'' then raise exception ''PEDIDO_CANCELADO: ese pedido está cancelado; no se registra el cobro'' using errcode = ''check_violation''; end if;',
    'if (select x.status from public.orders x where x.id = l.order_id) <> ''cancelled'' and coalesce((select v.saldo from public.v_order_money v where v.order_id = l.order_id), 0) <= 0 then raise exception ''YA_PAGADO: ese pedido ya está pagado (¿lo cobró el chofer?); no se registra otra vez'' using errcode = ''check_violation''; end if;');
  d := pg_get_functiondef('public.cc_retomar_conversacion(uuid)'::regprocedure);
  execute replace(d, 'raise exception ''ATENDIDA_POR_OTRO: % la está atendiendo ahora'', coalesce(public._cc_nombre_personal(coalesce(c.tomada_por, c.seller_profile_id)), ''otra persona'')',
    'raise exception ''ATENDIDA_POR_OTRO: % %'', coalesce(public._cc_nombre_personal(coalesce(c.tomada_por, c.seller_profile_id)), ''otra persona''), case when c.modo = ''human_active'' then ''la está atendiendo ahora'' else ''la tiene asignada; pídele a Dirección si debe ser tuya'' end');
end $patch$;

create or replace function public._lp_cancelar_con_pedido_tr() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  update public.pago_links set estado = 'cancelado', updated_at = now() where order_id = new.id and estado = 'solicitado';
  return new;
end;
$$;

do $post$ begin
  if position('YA_PAGADO' in pg_get_functiondef('public.link_pago_pagado(uuid,text)'::regprocedure)) = 0
     or position('la tiene asignada' in pg_get_functiondef('public.cc_retomar_conversacion(uuid)'::regprocedure)) = 0 then raise exception 'REVISION: no quedó aplicada'; end if;
end $post$;
