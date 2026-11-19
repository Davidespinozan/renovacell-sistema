-- AUDITORÍA 19 nov 2026 (vendedor + doctor) · correcciones de la base que impedían operar o daban datos incorrectos.
--   1. Checkout del doctor invitado: sus domicilios importados de Odoo están ligados al CLIENTE (customer_id) y no a su
--      cuenta (doctor_id); _cc_chk_direccion solo aceptaba los de doctor_id → «revisa la dirección». Ahora acepta ambos.
--   2. Carrito: se revisaba que hubiera «algo» de existencia, no que alcanzara: un lote de 1 dejaba confirmar 5.
--   3. Pedido capturado por una vendedora para un cliente sin cartera: no lo veía nunca más. Ahora el pedido guarda quién
--      lo capturó (placed_by_id) y ella lo puede ver (no cambia a quién se le ATRIBUYE la venta: sigue siendo la cartera).
--   4. Cuentas internas (profiles.interna) ya no son elegibles para recibir conversaciones (se perdían en «Lucía · Ventas»).
--   5. Retomar ya no le quita la conversación a la persona a quien se la acaban de pasar o asignar.
--   6. Link de pago de un pedido CANCELADO: se cancela solo y ya no se puede mandar ni marcar «Ya pagó» (antes cobraba
--      sobre un pedido muerto).
do $pre$ begin
  if position('where l.doctor_id = p_profile and l.active' in pg_get_functiondef('public._cc_chk_direccion(uuid,uuid)'::regprocedure)) = 0 then raise exception 'AUD-1: _cc_chk_direccion cambió'; end if;
  if position('''problema'', ''SIN_DISPONIBILIDAD''); end if;' in pg_get_functiondef('public._cc_chk_lineas(uuid,uuid)'::regprocedure)) = 0 then raise exception 'AUD-2: _cc_chk_lineas cambió'; end if;
  if position('jsonb_build_object(''placed_by'', coalesce(v_placed, ''Ventas''))' in pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = 0 then raise exception 'AUD-3: crear_pedido cambió'; end if;
  if position('select coalesce((select p.active and p.role_id = ''pos''' in pg_get_functiondef('public._cc_vendedor_elegible(uuid,boolean)'::regprocedure)) = 0 then raise exception 'AUD-4: _cc_vendedor_elegible cambió'; end if;
  if position('  if c.modo = ''human_active'' then' in pg_get_functiondef('public.cc_retomar_conversacion(uuid)'::regprocedure)) = 0 then raise exception 'AUD-5: cc_retomar_conversacion cambió'; end if;
end $pre$;

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public._cc_chk_direccion(uuid,uuid)'::regprocedure);
  execute replace(d, 'where l.doctor_id = p_profile and l.active',
    'where (l.doctor_id = p_profile or (l.doctor_id is null and l.customer_id is not null and l.customer_id = public._cc_chk_customer(p_profile))) and l.active');

  d := pg_get_functiondef('public._cc_chk_lineas(uuid,uuid)'::regprocedure);
  execute replace(d, '''problema'', ''SIN_DISPONIBILIDAD''); end if;',
    '''problema'', ''SIN_DISPONIBILIDAD''); elsif it.quantity > (select coalesce(sum(s.disponible), 0) from public.v_stock_disponible s where s.product_id = it.product_id and not s.caducado) then problemas := problemas || jsonb_build_object(''product_id'', it.product_id, ''problema'', ''SIN_DISPONIBILIDAD'', ''disponible'', (select coalesce(sum(s.disponible), 0) from public.v_stock_disponible s where s.product_id = it.product_id and not s.caducado)); end if;');

  d := pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure);
  execute replace(d, 'jsonb_build_object(''placed_by'', coalesce(v_placed, ''Ventas''))',
                     'jsonb_build_object(''placed_by'', coalesce(v_placed, ''Ventas''), ''placed_by_id'', auth.uid())');

  d := pg_get_functiondef('public._cc_vendedor_elegible(uuid,boolean)'::regprocedure);
  execute replace(d, 'select coalesce((select p.active and p.role_id = ''pos''', 'select coalesce((select p.active and p.role_id = ''pos'' and not coalesce(p.interna, false)');

  d := pg_get_functiondef('public.cc_retomar_conversacion(uuid)'::regprocedure);
  execute replace(d, '  if c.modo = ''human_active'' then',
    '  if c.modo = ''human_active'' or (c.modo in (''human_assigned'', ''human_requested'') and c.seller_profile_id is not null and c.seller_profile_id <> v_uid) then');
end $patch$;

-- 3b. La vendedora ve los pedidos que ELLA capturó (además de los de su cartera).
do $pol$
declare q text;
begin
  select qual into q from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped';
  if q is null then raise exception 'AUD-3b: falta la política orders_select_scoped'; end if;
  if position('placed_by_id' in q) = 0 then
    execute 'alter policy orders_select_scoped on public.orders using ((' || q || ') OR ((auth_role() = ''pos''::text) AND ((shipping_meta ->> ''placed_by_id''::text) = (auth.uid())::text)))';
  end if;
end $pol$;

-- 6. Links de pago y pedidos cancelados.
do $patch6$
declare d text;
begin
  d := pg_get_functiondef('public.link_pago_enviar(uuid,text)'::regprocedure);
  if position('PEDIDO_CANCELADO' in d) = 0 then
    execute replace(d, 'raise exception ''LINK_NO_ACTIVO: esa solicitud ya no está activa'' using errcode = ''check_violation''; end if;',
      'raise exception ''LINK_NO_ACTIVO: esa solicitud ya no está activa'' using errcode = ''check_violation''; end if;
  if (select x.status from public.orders x where x.id = l.order_id) = ''cancelled'' then raise exception ''PEDIDO_CANCELADO: ese pedido está cancelado; el link ya no sirve'' using errcode = ''check_violation''; end if;');
  end if;
  d := pg_get_functiondef('public.link_pago_pagado(uuid,text)'::regprocedure);
  if position('PEDIDO_CANCELADO' in d) = 0 then
    execute replace(d, 'raise exception ''LINK_NO_ENVIADO: solo se marca pagado un link ya enviado'' using errcode = ''check_violation''; end if;',
      'raise exception ''LINK_NO_ENVIADO: solo se marca pagado un link ya enviado'' using errcode = ''check_violation''; end if;
  if (select x.status from public.orders x where x.id = l.order_id) = ''cancelled'' then raise exception ''PEDIDO_CANCELADO: ese pedido está cancelado; no se registra el cobro'' using errcode = ''check_violation''; end if;');
  end if;
end $patch6$;

create or replace function public._lp_cancelar_con_pedido_tr() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  update public.pago_links set estado = 'cancelado', updated_at = now() where order_id = new.id and estado in ('solicitado', 'enviado');
  return new;
end;
$$;
revoke all on function public._lp_cancelar_con_pedido_tr() from public, anon, authenticated;
drop trigger if exists lp_cancelar_con_pedido on public.orders;
create trigger lp_cancelar_con_pedido after update of status on public.orders for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled') execute function public._lp_cancelar_con_pedido_tr();

do $post$ begin
  if position('placed_by_id' in (select qual from pg_policies where tablename = 'orders' and policyname = 'orders_select_scoped')) = 0
     or position('interna' in pg_get_functiondef('public._cc_vendedor_elegible(uuid,boolean)'::regprocedure)) = 0
     or position('PEDIDO_CANCELADO' in pg_get_functiondef('public.link_pago_pagado(uuid,text)'::regprocedure)) = 0 then raise exception 'AUDITORIA: no quedó aplicada'; end if;
end $post$;
