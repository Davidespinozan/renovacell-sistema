-- Reversa de 20270316120000_cliente_de_conversacion.sql.
do $d$
declare v text;
begin
  v := pg_get_functiondef('public.cc_cliente_pedidos(uuid)'::regprocedure);
  if position('v_cust := public._cc_cliente_conv(p_conv);   -- ficha ligada o la de la cuenta del doctor' in v) > 0 then
    execute replace(v, 'v_cust := public._cc_cliente_conv(p_conv);   -- ficha ligada o la de la cuenta del doctor', 'select c.customer_id into v_cust from public.cc_conversations c where c.id = p_conv;'); end if;
  v := pg_get_functiondef('public._cc_pago_adjunto(uuid,uuid)'::regprocedure);
  if position('m.actor_type in (''visitor'', ''doctor'') and public._cc_cliente_conv(c.id) = v_cust;   -- también la foto del doctor en su portal' in v) > 0 then
    execute replace(v, 'm.actor_type in (''visitor'', ''doctor'') and public._cc_cliente_conv(c.id) = v_cust;   -- también la foto del doctor en su portal', 'm.actor_type = ''visitor'' and c.customer_id = v_cust;'); end if;
  v := pg_get_functiondef('public.seguimiento_de'::regproc);
  if position('v_cust := public._cc_cliente_conv(p_conv);' in v) > 0 then execute replace(v, 'v_cust := public._cc_cliente_conv(p_conv);', 'select customer_id into v_cust from public.cc_conversations where id = p_conv;'); end if;
  v := pg_get_functiondef('public.seguimiento_guardar'::regproc);
  if position('v_cust := public._cc_cliente_conv(p_conv);' in v) > 0 then execute replace(v, 'v_cust := public._cc_cliente_conv(p_conv);', 'select customer_id into v_cust from public.cc_conversations where id = p_conv;'); end if;
end $d$;
drop function if exists public._cc_cliente_conv(uuid);
