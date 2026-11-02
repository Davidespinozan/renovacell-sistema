-- VERIFICACIÓN POR WHATSAPP (20270306) · down: sin solicitudes ni señal de compra; el push de alertas vuelve a la 20270305.
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind in ('handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe'))
  execute function public._cc_aviso_push_tr();
drop function if exists public.cc_senal_interes(uuid, text);
drop function if exists public.cc_solicitud_alta_rechazar(uuid, text);
drop function if exists public.cc_alta_wa_cerrar(uuid, uuid, uuid, uuid);
drop function if exists public.cc_solicitud_alta_de(uuid);
drop function if exists public.cc_ia_solicitar_alta(uuid, text, text, text, text, text);
drop function if exists public._cc_avisar_responsable(uuid, text, text, text);
drop table if exists public.cc_solicitudes_alta;
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
                         when 'handoff_sin_vendedor' then '⚠️ Solicitud sin vendedor' when 'handoff_aviso' then '⏰ Cliente esperando' else 'Renovacell' end);
end;
$$;
