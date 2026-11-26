-- ============================================================================
-- FACTURA SOLO DENTRO DEL MES DE LA VENTA (26 nov 2026, dueño/Toño: «que solo se le permita facturar al cliente antes
-- del último día del mes; si no, lo que quedó va a público en general»).
--   · solicitar_cfdi rechaza una solicitud NUEVA si hoy (Culiacán) ya pasó el último día del mes de la venta.
--   · Las solicitudes hechas a tiempo se pueden corregir y timbrar después. Sin excepción administrativa (regla SAT).
--   · La factura global mensual a público en general es otra etapa (depende de las claves de unidad e IVA).
-- Rollback: supabase/rollback/factura_en_mes/99_down.sql
-- ============================================================================
CREATE OR REPLACE FUNCTION public.solicitar_cfdi(p_op_id uuid, p_order_id uuid, p_receiver jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_req jsonb; v_prev jsonb; v_role text := public.auth_role();
  v_doctor uuid; v_cust uuid; v_status text; v_total numeric; v_curr text; v_venta date;
  v_recv jsonb; v_fp text; v_live public.fiscal_documents; v_res jsonb;
begin
  if p_order_id is null then raise exception 'PEDIDO_REQUERIDO'; end if;
  v_req := jsonb_build_object('order', p_order_id,
             'receiver', case when p_receiver is null then null else public._fiscal_clean(p_receiver) end);
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_solicitado', v_req);
  if v_prev is not null then return v_prev; end if;

  select o.doctor_id, o.customer_id, o.status, o.total, o.currency, (o.created_at at time zone 'America/Mazatlan')::date
    into v_doctor, v_cust, v_status, v_total, v_curr, v_venta
    from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  -- Autorización: Dirección/Facturación/Punto de venta, o el propio dueño del pedido.
  if v_role = any (array['admin','billing']) or (v_role = 'pos' and public._sec_c1_pos_ve_pedido(p_order_id)) then null;   -- FISCAL-1: Ventas, solo sus pedidos
  elsif v_doctor = auth.uid()
     or exists (select 1 from public.customers c where c.id = v_cust and c.profile_id = auth.uid()) then null;
  else raise exception 'NO_AUTORIZADO: no puedes solicitar la factura de este pedido';
  end if;

  if v_status = 'cancelled' then
    raise exception 'PEDIDO_CANCELADO: un pedido cancelado no se factura';
  end if;

  v_recv := public._w3_receptor(p_order_id, p_receiver);
  if v_recv is null then
    raise exception 'DATOS_FISCALES_REQUERIDOS: faltan datos fiscales completos del receptor (RFC, razón social, régimen, CP, uso de CFDI y correo). No se factura con datos incompletos.';
  end if;
  v_fp := public._w3_fingerprint(p_order_id, v_recv);

  select * into v_live from public.fiscal_documents f
   where f.order_id = p_order_id and f.kind = 'ingreso'
     and f.status in ('pendiente','en_proceso','timbrado','incierto');

  if found then
    if v_live.status = 'timbrado' then
      v_res := jsonb_build_object('status', 'already_stamped', 'doc_id', v_live.id, 'uuid', v_live.uuid);
      return public._w3_op_finish(p_op_id, 'cfdi_solicitado', v_req, v_res);
    elsif v_live.status = 'en_proceso' then
      raise exception 'CFDI_EN_PROCESO: ya hay un timbrado en curso para este pedido. Espera a que termine.';
    elsif v_live.status = 'incierto' then
      raise exception 'CFDI_INCIERTO: no se sabe si el SAT ya timbró este pedido. Dirección debe conciliar antes de volver a intentar.';
    end if;

    -- pendiente: se puede CORREGIR el contenido mientras no haya salido a ningún PAC.
    if v_live.request_fingerprint = v_fp then
      v_res := jsonb_build_object('status', 'already_requested', 'doc_id', v_live.id, 'fiscal_status', 'pendiente');
    else
      perform set_config('app.trusted', 'on', true);
      update public.fiscal_documents set receiver = v_recv, request_fingerprint = v_fp,
             total = v_total, currency = coalesce(v_curr, 'MXN')
       where id = v_live.id;
      perform set_config('app.trusted', v_trusted, true);
      insert into public.fiscal_document_events (fiscal_document_id, from_status, to_status, event, reason, actor, actor_role, op_id)
      values (v_live.id, 'pendiente', 'pendiente', 'solicitud_actualizada',
              'se corrigió el contenido de la solicitud antes de timbrar', auth.uid(), coalesce(v_role, ''), p_op_id);
      v_res := jsonb_build_object('status', 'updated', 'doc_id', v_live.id, 'fiscal_status', 'pendiente');
    end if;
    perform public._w3_proyectar(p_order_id);
    return public._w3_op_finish(p_op_id, 'cfdi_solicitado', v_req, v_res);
  end if;

  -- FACTURA EN EL MES (26 nov 2026, dueño): el cliente pide su factura a más tardar el ÚLTIMO DÍA del mes de la venta
  -- (hora de Culiacán). Después, la venta va a la factura global del mes a público en general y ya no se factura a su
  -- nombre. Solo frena solicitudes NUEVAS: una pedida a tiempo se puede corregir y timbrar.
  if public.hoy_local() > (date_trunc('month', v_venta) + interval '1 month - 1 day')::date then
    raise exception 'FACTURA_FUERA_DE_MES: la venta es de %; la factura se pide a más tardar el % y ahora va en la factura global del mes a público en general',
      to_char(v_venta, 'DD/MM/YYYY'), to_char((date_trunc('month', v_venta) + interval '1 month - 1 day')::date, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  -- Nueva intención. `total` y `currency` se congelan; el DESGLOSE (subtotal/IVA),
  -- la forma y el método de pago quedan nulos a propósito: dependen de decisiones
  -- fiscales abiertas (D-W3-1…4) y se derivan del libro de W2 en W3-C. No se
  -- inventa una tasa de IVA ni una forma de pago para rellenarlos.
  perform set_config('app.trusted', 'on', true);
  insert into public.fiscal_documents (id, order_id, kind, status, request_fingerprint, receiver,
                                       total, currency, actor, actor_role, op_id)
  values (p_op_id, p_order_id, 'ingreso', 'pendiente', v_fp, v_recv,
          v_total, coalesce(v_curr, 'MXN'), auth.uid(), coalesce(v_role, ''), p_op_id);
  perform set_config('app.trusted', v_trusted, true);

  insert into public.fiscal_document_events (fiscal_document_id, from_status, to_status, event, reason, actor, actor_role, op_id)
  values (p_op_id, null, 'pendiente', 'solicitud', 'solicitud de CFDI registrada', auth.uid(), coalesce(v_role, ''), p_op_id);

  perform public._w3_proyectar(p_order_id);
  perform public._fiscal_audit('Solicitud de CFDI registrada', 'order:' || p_order_id, v_recv);

  return public._w3_op_finish(p_op_id, 'cfdi_solicitado', v_req,
    jsonb_build_object('status', 'applied', 'doc_id', p_op_id, 'fiscal_status', 'pendiente'));
end;
$function$;
