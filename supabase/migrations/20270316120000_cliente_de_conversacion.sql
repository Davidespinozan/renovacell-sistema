-- ============================================================================
-- CLIENTE DE LA CONVERSACIÓN (ensayo E2E 2 nov 2026). La ficha del cliente de una conversación se guardaba solo al
-- vincular o dar de alta desde WhatsApp (cc_conversations.customer_id). Un doctor que escribe desde su PORTAL nunca la
-- tenía: su vendedor no veía sus pedidos en el chat ("no puedes ver los pedidos de este cliente"), no podía usar una foto
-- que el doctor mandó como comprobante y sus seguimientos no se ligaban a su ficha. Ahora todas usan la misma regla que
-- el panel del cliente (cc_cliente_de_conversacion): la ficha ligada o, si no hay, la de la cuenta del doctor.
-- ============================================================================
create or replace function public._cc_cliente_conv(p_conv uuid) returns uuid
  language sql stable security definer set search_path = public as
$$ select coalesce(c.customer_id, (select x.id from public.customers x where c.profile_id is not null and x.profile_id = c.profile_id order by x.active desc, x.created_at limit 1))
     from public.cc_conversations c where c.id = p_conv $$;
revoke all on function public._cc_cliente_conv(uuid) from public, anon, authenticated;

do $d$
declare v text;
begin
  v := pg_get_functiondef('public.cc_cliente_pedidos(uuid)'::regprocedure);
  if position('select c.customer_id into v_cust from public.cc_conversations c where c.id = p_conv;' in v) = 0 then raise exception 'CLIENTE_CONV: cc_cliente_pedidos cambió'; end if;
  execute replace(v, 'select c.customer_id into v_cust from public.cc_conversations c where c.id = p_conv;', 'v_cust := public._cc_cliente_conv(p_conv);   -- ficha ligada o la de la cuenta del doctor');

  v := pg_get_functiondef('public._cc_pago_adjunto(uuid,uuid)'::regprocedure);
  if position('where ad.id = p_adjunto and m.actor_type = ''visitor'' and c.customer_id = v_cust;' in v) = 0 then raise exception 'CLIENTE_CONV: _cc_pago_adjunto cambió'; end if;
  execute replace(v, 'where ad.id = p_adjunto and m.actor_type = ''visitor'' and c.customer_id = v_cust;', 'where ad.id = p_adjunto and m.actor_type in (''visitor'', ''doctor'') and public._cc_cliente_conv(c.id) = v_cust;   -- también la foto del doctor en su portal');

  v := pg_get_functiondef('public.seguimiento_de'::regproc);
  if position('select customer_id into v_cust from public.cc_conversations where id = p_conv;' in v) = 0 then raise exception 'CLIENTE_CONV: seguimiento_de cambió'; end if;
  execute replace(v, 'select customer_id into v_cust from public.cc_conversations where id = p_conv;', 'v_cust := public._cc_cliente_conv(p_conv);');

  v := pg_get_functiondef('public.seguimiento_guardar'::regproc);
  if position('select customer_id into v_cust from public.cc_conversations where id = p_conv;' in v) = 0 then raise exception 'CLIENTE_CONV: seguimiento_guardar cambió'; end if;
  execute replace(v, 'select customer_id into v_cust from public.cc_conversations where id = p_conv;', 'v_cust := public._cc_cliente_conv(p_conv);');
end $d$;
