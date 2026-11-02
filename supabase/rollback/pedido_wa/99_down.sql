-- PEDIDO POR WHATSAPP (20270307) · down: sin cierre de pedido por WhatsApp; alertas como en la 20270306.
drop trigger if exists cc_comprobante_wa on public.cc_adjuntos;
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind in ('handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe', 'senal_compra', 'verificacion_wa'))
  execute function public._cc_aviso_push_tr();
drop function if exists public._cc_comprobante_wa_tr();
drop function if exists public.cc_ia_pedido_confirmar(uuid, uuid);
drop function if exists public.cc_ia_pedido_revisar(uuid, uuid, text, jsonb);
drop function if exists public.cc_ia_direccion_guardar(uuid, uuid, jsonb);
drop function if exists public._cc_ia_exige_identidad(uuid, uuid);
drop function if exists public._cc_actuar_como(uuid);
create or replace function public._cc_responsable_comercial(p_conv uuid) returns uuid
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    case when c.modo in ('human_assigned', 'human_active') then c.seller_profile_id end,
    case when c.profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(c.profile_id), false) then public._cc_vendedor_de(c.profile_id) end,
    case when c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then public._cc_vendedor_de_cliente(c.customer_id) end,
    case when public._cc_vendedor_elegible(c.ultimo_asesor_id, false) then c.ultimo_asesor_id end)
  from public.cc_conversations c where c.id = p_conv
$$;
