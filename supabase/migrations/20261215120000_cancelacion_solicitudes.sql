-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CANCELACIÓN COMPLETA (migración 162) · SOLICITAR, APROBAR Y AVISAR
--   Pedido del dueño (15 oct 2026): que el flujo de cancelar quede completo. Cancelar una venta pagada sigue siendo
--   SOLO de Dirección (cancelar_pedido no cambia). Lo nuevo:
--   · order_cancel_requests        NUEVA. Vendedor, almacén, empaque o facturación SOLICITAN la cancelación con motivo;
--                                  una sola pendiente por pedido. Se lee con RLS (quien ve el pedido); se escribe solo
--                                  con los comandos.
--   · solicitar_cancelacion        NUEVA. Crea la solicitud (idempotente) y avisa a Dirección.
--   · resolver_solicitud_cancelacion NUEVA. Dirección aprueba (cancela con cancelar_pedido, en la misma transacción) o
--                                  rechaza con nota; avisa a quien la pidió.
--   · _cancelacion_avisos (trigger) NUEVA. Al quedar cancelado un pedido (order_cancellations) avisa al doctor, a su
--                                  vendedor, al almacén si hay piezas por reingresar y a Dirección/Facturación si hay
--                                  reembolso por revisar. Si había una solicitud pendiente, queda aprobada.
--   · _cancelacion_bloquea_envio (triggers) NUEVA. Con una solicitud pendiente no se puede crear guía ni marcar enviado.
--   NO cambia: cancelar_pedido, reglas de dinero, inventario, devoluciones ni revisión económica.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/cancelacion_solicitudes/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.order_cancel_requests') is not null then raise exception 'CANCELACION-SOL: ya aplicada'; end if;
  if to_regprocedure('public.cancelar_pedido(uuid,uuid,text)') is null or to_regprocedure('public._cc_notificar(text,uuid,uuid[],text[],text,text,text)') is null
     or to_regprocedure('public.order_vendor_email(uuid)') is null or to_regprocedure('public._cx0c_venta_pos_propia(uuid)') is null then
    raise exception 'CANCELACION-SOL: faltan piezas previas (W1/W2, CHV2-A, CX-0c)';
  end if;
end $pre$;

create table public.order_cancel_requests (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  requested_by    uuid not null references public.profiles(id),
  requester_role  text not null,
  reason          text not null check (length(btrim(reason)) between 5 and 500),
  status          text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada')),
  resolved_by     uuid references public.profiles(id),
  resolved_at     timestamptz,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 500),
  created_at      timestamptz not null default now()
);
comment on table public.order_cancel_requests is 'CANCELACIÓN · solicitud de cancelar un pedido (la decide Dirección). Una pendiente por pedido.';
create unique index ux_cancel_req_pendiente on public.order_cancel_requests (order_id) where status = 'pendiente';
create index ix_cancel_req_status on public.order_cancel_requests (status, created_at desc);
alter table public.order_cancel_requests enable row level security;
revoke all on table public.order_cancel_requests from public, anon, authenticated;
grant select on table public.order_cancel_requests to authenticated;   -- escribir: solo con los comandos
grant select, insert, update, delete on table public.order_cancel_requests to service_role;
-- Ve la solicitud quien ve el pedido (el RLS de orders aplica dentro de la subconsulta), salvo el doctor.
create policy cancel_req_ver on public.order_cancel_requests for select to authenticated
  using (public.auth_role() <> 'doctor' and exists (select 1 from public.orders o where o.id = order_id));

-- ¿Quien pide puede ver ESTE pedido? (espejo de orders_select_scoped para los roles que solicitan)
create function public._cancel_req_ve_pedido(p_order uuid) returns boolean
  language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.orders o where o.id = p_order and (
    public.auth_role() in ('warehouse', 'packing', 'billing')
    or (public.auth_role() = 'pos' and (
          (o.shipping_meta ->> 'seller_profile_id') = auth.uid()::text
       or ((o.shipping_meta ->> 'seller_profile_id') is null and (o.shipping_meta ->> 'seller') = (auth.jwt() ->> 'email'))
       or public.order_vendor_email(o.id) = (auth.jwt() ->> 'email')
       or public._cx0c_venta_pos_propia(o.id)))))
$$;
revoke all on function public._cancel_req_ve_pedido(uuid) from public, anon, authenticated;

create function public.solicitar_cancelacion(p_order uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_role text := public.auth_role(); v_uid uuid := auth.uid(); o record; r public.order_cancel_requests;
        v_motivo text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null or v_role not in ('pos', 'warehouse', 'packing', 'billing') then
    raise exception 'NO_AUTORIZADO: Dirección cancela directo; los demás solicitan' using errcode = 'insufficient_privilege';
  end if;
  if not public._cancel_req_ve_pedido(p_order) then raise exception 'PEDIDO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if length(v_motivo) < 5 then raise exception 'MOTIVO_REQUERIDO: explica por qué se cancela' using errcode = 'check_violation'; end if;
  select id, external_ref, status into o from public.orders where id = p_order for update;
  if o.status in ('shipped', 'delivered', 'fulfilled') then raise exception 'USAR_DEVOLUCION: el pedido ya salió; registra una devolución' using errcode = 'check_violation'; end if;
  if o.status not in ('draft', 'pending_payment', 'paid', 'picking', 'packed') then raise exception 'ESTADO_INVALIDO: %', o.status using errcode = 'check_violation'; end if;
  select * into r from public.order_cancel_requests where order_id = p_order and status = 'pendiente';
  if found then return jsonb_build_object('id', r.id, 'status', 'pendiente', 'idempotente', true); end if;
  insert into public.order_cancel_requests (order_id, requested_by, requester_role, reason) values (p_order, v_uid, v_role, left(v_motivo, 500)) returning * into r;
  perform public._cc_notificar('cancelacion_solicitada', null, null, array['admin'],
    'Solicitan cancelar el pedido ' || coalesce(o.external_ref, '') || ': ' || left(v_motivo, 160), 'av_ventas', 'cancel_req:' || r.id::text);
  return jsonb_build_object('id', r.id, 'status', 'pendiente', 'idempotente', false);
end;
$$;

create function public.resolver_solicitud_cancelacion(p_request uuid, p_aprobar boolean, p_nota text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.order_cancel_requests; o record; v_nota text := nullif(btrim(left(coalesce(p_nota, ''), 500)), ''); v_res jsonb;
begin
  if auth.uid() is null or public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección resuelve' using errcode = 'insufficient_privilege'; end if;
  if p_aprobar is null then raise exception 'DECISION_INVALIDA' using errcode = 'check_violation'; end if;
  select * into r from public.order_cancel_requests where id = p_request for update;
  if not found then raise exception 'SOLICITUD_INEXISTENTE' using errcode = 'check_violation'; end if;
  if r.status <> 'pendiente' then return jsonb_build_object('id', r.id, 'status', r.status, 'idempotente', true); end if;
  select id, external_ref into o from public.orders where id = r.order_id;
  if p_aprobar then
    -- La cancelación real es la de siempre (mismas reglas: guía activa, ya salió, dinero, reingreso). Si falla, nada cambia.
    v_res := public.cancelar_pedido(gen_random_uuid(), r.order_id, 'Solicitado (' || r.requester_role || '): ' || r.reason || coalesce(' · ' || v_nota, ''));
    update public.order_cancel_requests set status = 'aprobada', resolved_by = auth.uid(), resolved_at = now(), resolution_note = coalesce(v_nota, resolution_note) where id = r.id;
    perform public._cc_notificar('cancelacion_aprobada', null, array[r.requested_by], null,
      'Dirección canceló el pedido ' || coalesce(o.external_ref, '') || ' que solicitaste.', 'inicio', 'cancel_req_ok:' || r.id::text);
    return jsonb_build_object('id', r.id, 'status', 'aprobada', 'cancelacion', v_res);
  end if;
  if v_nota is null then raise exception 'NOTA_REQUERIDA: explica por qué no se cancela' using errcode = 'check_violation'; end if;
  update public.order_cancel_requests set status = 'rechazada', resolved_by = auth.uid(), resolved_at = now(), resolution_note = v_nota where id = r.id;
  perform public._cc_notificar('cancelacion_rechazada', null, array[r.requested_by], null,
    'Dirección no canceló el pedido ' || coalesce(o.external_ref, '') || ': ' || left(v_nota, 160), 'inicio', 'cancel_req_no:' || r.id::text);
  return jsonb_build_object('id', r.id, 'status', 'rechazada');
end;
$$;

-- Avisos al quedar cancelado (cualquier camino: Dirección directo, solicitud aprobada o el doctor antes de pagar).
create function public._cancelacion_avisos() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare o record; v_folio text; v_seller uuid; v_cliente text; v_piezas int; v_cobrado numeric;
begin
  select id, external_ref, doctor_id, shipping_meta, total into o from public.orders where id = new.order_id;
  v_folio := coalesce(o.external_ref, '');
  v_cliente := nullif(btrim(coalesce(o.shipping_meta -> 'customer' ->> 'name', '')), '');
  begin v_seller := nullif(o.shipping_meta ->> 'seller_profile_id', '')::uuid; exception when others then v_seller := null; end;
  update public.order_cancel_requests set status = 'aprobada', resolved_by = coalesce(resolved_by, new.cancelled_by), resolved_at = coalesce(resolved_at, now())
   where order_id = new.order_id and status = 'pendiente';
  if o.doctor_id is not null and new.actor_role <> 'doctor' then
    perform public._cc_notificar('pedido_cancelado', null, array[o.doctor_id], null,
      'Tu pedido ' || v_folio || ' fue cancelado.' || case when new.refund_review = 'pendiente_revision' then ' Renovacell te contactará para el reembolso.' else '' end,
      'pedidosdr', 'cancel_doc:' || new.order_id::text);
  end if;
  if v_seller is not null and v_seller is distinct from new.cancelled_by then
    perform public._cc_notificar('pedido_cancelado', null, array[v_seller], null,
      'Se canceló el pedido ' || v_folio || coalesce(' de ' || v_cliente, '') || '.', 'clientes', 'cancel_seller:' || new.order_id::text);
  end if;
  if new.return_id is not null then
    select coalesce(sum(qty), 0) into v_piezas from public.stock_return_lines where return_id = new.return_id;
    perform public._cc_notificar('reingreso_pendiente', null, null, array['warehouse'],
      'Pedido ' || v_folio || ' cancelado: reingresa ' || v_piezas || case when v_piezas = 1 then ' pieza' else ' piezas' end || ' en Devoluciones.', 'devoluciones', 'cancel_ret:' || new.order_id::text);
  end if;
  if new.refund_review = 'pendiente_revision' then
    select cobrado_neto into v_cobrado from public.v_order_money where order_id = new.order_id;
    perform public._cc_notificar('reembolso_pendiente', null, null, array['admin', 'billing'],
      'Reembolso por revisar: pedido ' || v_folio || ' cancelado' || case when coalesce(v_cobrado, 0) > 0 then ' con $' || to_char(v_cobrado, 'FM999,999,990.00') || ' cobrados' else ' con pago registrado' end || '.',
      'av_revision', 'cancel_money:' || new.order_id::text);
  end if;
  return new;
end;
$$;
create trigger order_cancellations_avisos after insert on public.order_cancellations for each row execute function public._cancelacion_avisos();

-- Con una solicitud pendiente nadie crea guía ni marca enviado: Dirección decide primero.
create function public._cancelacion_bloquea_envio() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  -- orders trae `id`; shipping_attempts trae `order_id` (por JSON para no tocar un campo que la fila no tiene).
  if exists (select 1 from public.order_cancel_requests where order_id = coalesce(to_jsonb(new) ->> 'order_id', to_jsonb(new) ->> 'id')::uuid and status = 'pendiente') then
    raise exception 'CANCELACION_SOLICITADA: este pedido tiene una cancelación por resolver; Dirección decide antes de enviarlo' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger shipping_attempts_cancelacion before insert on public.shipping_attempts for each row execute function public._cancelacion_bloquea_envio();
create trigger orders_cancelacion_envio before update of status on public.orders for each row
  when (new.status = 'shipped' and old.status is distinct from 'shipped') execute function public._cancelacion_bloquea_envio();

alter function public._cancel_req_ve_pedido(uuid) owner to postgres;
alter function public.solicitar_cancelacion(uuid, text) owner to postgres;
alter function public.resolver_solicitud_cancelacion(uuid, boolean, text) owner to postgres;
alter function public._cancelacion_avisos() owner to postgres;
alter function public._cancelacion_bloquea_envio() owner to postgres;
grant execute on function public._cancel_req_ve_pedido(uuid) to service_role;
revoke all on function public.solicitar_cancelacion(uuid, text), public.resolver_solicitud_cancelacion(uuid, boolean, text) from public, anon;
grant execute on function public.solicitar_cancelacion(uuid, text), public.resolver_solicitud_cancelacion(uuid, boolean, text) to authenticated, service_role;
revoke all on function public._cancelacion_avisos(), public._cancelacion_bloquea_envio() from public, anon, authenticated;

do $post$ begin
  if has_table_privilege('authenticated', 'public.order_cancel_requests', 'insert,update,delete')
     or has_function_privilege('anon', 'public.solicitar_cancelacion(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public._cancel_req_ve_pedido(uuid)', 'execute') then
    raise exception 'CANCELACION-SOL: permisos inesperados';
  end if;
end $post$;
