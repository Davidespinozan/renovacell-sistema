-- Reversa de 20270309120000_link_pago.sql: deja todo como estaba (push y plantillas de correo de antes).
drop function if exists public.link_pago_de_pedido(uuid);
drop function if exists public.links_pago_lista();
drop function if exists public.link_pago_pagado(uuid, text);
drop function if exists public.link_pago_cancelar(uuid, text);
drop function if exists public.link_pago_enviar(uuid, text);
drop function if exists public.cc_ia_link_pago(uuid, uuid, text);
drop function if exists public.link_pago_solicitar(uuid);
drop function if exists public._lp_solicitar(uuid, text, uuid);
drop function if exists public._lp_json(public.pago_links);
drop function if exists public._lp_avisar(uuid, text, text, text);
drop function if exists public._lp_vendedor(uuid);
drop table if exists public.pago_links;
delete from public.comm_outbox where plantilla = 'link_pago';
alter table public.comm_outbox drop constraint if exists ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla = any (array['pedido_recibido', 'pago_recibido', 'pedido_enviado',
  'pedido_entregado', 'pedido_cancelado', 'reembolso_realizado', 'registro_recibido', 'cuenta_verificada', 'verificacion_rechazada', 'promocion',
  'cotizacion', 'difusion']));
create or replace function public.aviso_push_carga(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare n public.notifications; v_perfiles uuid[];
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into n from public.notifications where id = p_id;
  if not found then return null; end if;
  v_perfiles := coalesce(n.user_ids, '{}') || coalesce((select array_agg(p.id) from public.profiles p where p.active and p.role_id = any (coalesce(n.roles, '{}'))), '{}');
  if coalesce(array_length(v_perfiles, 1), 0) = 0 then return null; end if;
  return jsonb_build_object('perfiles', to_jsonb(v_perfiles), 'kind', n.kind, 'body', n.body, 'conversation_id', n.conversation_id,
    'title', case n.kind when 'handoff_asignado' then '🔔 Cliente esperando' when 'retoma' then '🔔 Tu cliente volvió a escribir'
                         when 'cliente_escribe' then '💬 Tu cliente está escribiendo' when 'handoff_escalado' then '⚠️ Cliente sin atender'
                         when 'handoff_sin_vendedor' then '⚠️ Solicitud sin vendedor' when 'handoff_aviso' then '⏰ Cliente esperando'
                         when 'senal_compra' then '🛒 Señal de compra' when 'verificacion_wa' then '🪪 Verificar a un cliente' else 'Renovacell' end);
end;
$$;
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind in ('handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe', 'senal_compra', 'verificacion_wa'))
  execute function public._cc_aviso_push_tr();
