-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PAY-EXP-01A-2 (migración 134) · REVISIÓN ECONÓMICA CENTRALIZADA (solo lectura)
--   · revision_economica(p_incluir_resueltos) devuelve los pedidos cuya situación de dinero requiere a Dirección o
--     Facturación. UN caso por pedido (aunque tenga varias señales) con todas sus incidencias activas, la
--     principal, la evidencia económica (declaraciones, asientos, reembolsos) y referencias a los registros.
--   · Fuentes canónicas, sin un segundo motor: v_order_money (montos), payment_claims, payment_entries, refunds,
--     order_cancellations y customers. Los montos salen SOLO de v_order_money.
--   · Incidencias (entrada → salida):
--       declaracion_abierta_en_cancelado   pedido cancelado con una declaración 'reportado'
--                                          → sale al verificarla o rechazarla (revisar_pago).
--       dinero_sin_reembolso_autorizado    pedido cancelado con cobrado_neto > reembolso_pendiente (dinero que
--                                          llegó y aún no tiene reembolso autorizado; cubre el pago tardío F-9 / D5)
--                                          → sale cuando los reembolsos autorizados lo cubren o se devuelve.
--       reembolso_autorizado_pendiente     reembolso_pendiente > 0 en cualquier pedido (cancelado o devolución)
--                                          → sale al pagarlo (pagar_reembolso).
--       cancelacion_sin_evidencia          cancelación marcada refund_review='pendiente_revision' sin ninguna de las
--                                          anteriores y SIN evidencia verificable de resolución (p. ej. señal
--                                          'stripe' sin dinero en el libro) → se queda abierta.
--     Un caso pendiente_revision SIN incidencias activas y CON evidencia verificable (declaraciones resueltas,
--     dinero neto 0 y sin reembolsos por pagar, sin señal Stripe no verificable) es 'resuelto' — nunca por un
--     campo visual: refund_review no cambia nunca y no se usa como prueba de resolución.
--   · Anomalías de Stripe: NO se incluyen (todavía no existe una fuente persistida; llega con 01A-4).
--   · Seguridad: SECURITY DEFINER con search_path fijo; identidad = auth.uid() → auth_role() en (admin, billing);
--     sin parámetros de rol; STABLE; no escribe. EXECUTE solo para authenticated (anon revocado).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.revision_economica(boolean)') is not null then raise exception 'PAY-EXP-01A-2: ya aplicada'; end if;
  if to_regclass('public.v_order_money') is null or to_regclass('public.payment_claims') is null or to_regclass('public.order_cancellations') is null
     or to_regprocedure('public.auth_role()') is null then
    raise exception 'PAY-EXP-01A-2: requiere W1/W2 (v_order_money, payment_claims, order_cancellations, auth_role)';
  end if;
end $pre$;

create or replace function public.revision_economica(p_incluir_resueltos boolean default false) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_casos jsonb;
begin
  if not (public.auth_role() = any (array['admin', 'billing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección/Facturación consulta la revisión económica' using errcode = 'insufficient_privilege';
  end if;

  with base as (
    select o.id, o.external_ref, o.status, o.total, o.doctor_id, o.customer_id, o.stripe_payment_id, o.created_at,
           m.cobrado_neto, m.reembolso_pendiente, m.saldo, m.estado_pago,
           x.created_at as cancelado_at, x.reason as motivo_cancelacion, x.money_signal, x.refund_review, x.actor_role as cancelado_por_rol,
           exists (select 1 from public.payment_claims c where c.order_id = o.id and c.status = 'reportado') as declaracion_abierta,
           exists (select 1 from public.payment_claims c where c.order_id = o.id) as tiene_declaraciones
      from public.orders o
      join public.v_order_money m on m.order_id = o.id
      left join public.order_cancellations x on x.order_id = o.id
     where o.status = 'cancelled' or m.reembolso_pendiente > 0 or x.refund_review = 'pendiente_revision'
  ), clasif as (
    select b.*,
           (b.status = 'cancelled' and b.declaracion_abierta)                                           as i_declaracion,
           (b.status = 'cancelled' and b.cobrado_neto - b.reembolso_pendiente > 0)                       as i_dinero,
           (b.reembolso_pendiente > 0)                                                                    as i_reembolso,
           (b.refund_review = 'pendiente_revision')                                                       as marcada
      from base b
  ), eval as (
    select c.*,
           -- Evidencia verificable de resolución (solo para cancelaciones marcadas sin incidencias activas).
           (not c.declaracion_abierta and c.cobrado_neto <= 0 and c.reembolso_pendiente <= 0
            and not (c.money_signal = 'stripe' and c.cobrado_neto <= 0 and c.stripe_payment_id is not null and
                     not exists (select 1 from public.payment_entries e where e.order_id = c.id))) as evidencia_resolucion
      from clasif c
  ), final as (
    select e.*,
           (e.marcada and not (e.i_declaracion or e.i_dinero or e.i_reembolso) and not e.evidencia_resolucion) as i_sin_evidencia
      from eval e
  ), casos as (
    select f.*,
           array_remove(array[
             case when f.i_declaracion then 'declaracion_abierta_en_cancelado' end,
             case when f.i_dinero then 'dinero_sin_reembolso_autorizado' end,
             case when f.i_reembolso then 'reembolso_autorizado_pendiente' end,
             case when f.i_sin_evidencia then 'cancelacion_sin_evidencia' end], null) as incidencias,
           case when f.i_declaracion or f.i_dinero or f.i_reembolso or f.i_sin_evidencia then 'abierto'
                when f.marcada and f.evidencia_resolucion then 'resuelto' end as estado_caso
      from final f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', k.id, 'folio', k.external_ref, 'estado_pedido', k.status, 'estado_caso', k.estado_caso,
           'incidencia_principal', k.incidencias[1], 'incidencias', to_jsonb(k.incidencias),
           'cliente', jsonb_build_object('customer_id', k.customer_id, 'doctor_id', k.doctor_id,
                        'nombre', coalesce((select cu.full_name from public.customers cu where cu.id = k.customer_id),
                                           (select p.full_name from public.profiles p where p.id = k.doctor_id))),
           'montos', jsonb_build_object('total', k.total, 'cobrado_neto', k.cobrado_neto, 'reembolso_pendiente', k.reembolso_pendiente,
                        'sin_reembolso_autorizado', greatest(k.cobrado_neto - k.reembolso_pendiente, 0), 'saldo', k.saldo, 'estado_pago', k.estado_pago),
           'cancelacion', case when k.cancelado_at is null then null else jsonb_build_object('fecha', k.cancelado_at, 'motivo', k.motivo_cancelacion,
                        'money_signal', k.money_signal, 'refund_review', k.refund_review, 'actor_rol', k.cancelado_por_rol) end,
           'declaraciones', coalesce((select jsonb_agg(jsonb_build_object('claim_id', c.id, 'estado', c.status, 'metodo', c.method, 'monto_declarado', c.amount_declared,
                        'referencia', c.reference, 'comprobante', c.proof_path, 'declarada_at', c.declared_at, 'resuelta_at', c.resolved_at,
                        'motivo_rechazo', c.reject_reason, 'entry_id', c.entry_id) order by c.declared_at)
                        from public.payment_claims c where c.order_id = k.id), '[]'::jsonb),
           'asientos', coalesce((select jsonb_agg(jsonb_build_object('entry_id', pe.id, 'direccion', pe.direction, 'metodo', pe.method, 'monto', pe.amount,
                        'fecha_valor', pe.value_date, 'claim_id', pe.claim_id, 'refund_id', pe.refund_id, 'reversal_of', pe.reversal_of, 'registrado_at', pe.created_at) order by pe.created_at)
                        from public.payment_entries pe where pe.order_id = k.id), '[]'::jsonb),
           'reembolsos', coalesce((select jsonb_agg(jsonb_build_object('refund_id', r.id, 'tipo', r.tipo, 'monto', r.monto, 'motivo', r.motivo, 'autorizado_at', r.created_at,
                        'pagado', exists (select 1 from public.payment_entries pe where pe.refund_id = r.id and pe.reversal_of is null)) order by r.created_at)
                        from public.refunds r where r.order_id = k.id), '[]'::jsonb),
           'evidencia_resolucion', case when k.estado_caso = 'resuelto' then to_jsonb(array_remove(array[
                        case when exists (select 1 from public.payment_claims c where c.order_id = k.id and c.status = 'rechazado') then 'declaraciones_rechazadas' end,
                        case when exists (select 1 from public.payment_entries pe where pe.order_id = k.id and pe.refund_id is not null) then 'reembolsos_pagados' end,
                        'dinero_neto_cero'], null)) end,
           'fecha_relevante', greatest(k.cancelado_at,
                        (select max(c.declared_at) from public.payment_claims c where c.order_id = k.id),
                        (select max(pe.created_at) from public.payment_entries pe where pe.order_id = k.id),
                        (select max(r.created_at) from public.refunds r where r.order_id = k.id))
         ) order by greatest(k.cancelado_at, k.created_at) desc), '[]'::jsonb)
    into v_casos
    from casos k
   where k.estado_caso = 'abierto' or (p_incluir_resueltos and k.estado_caso = 'resuelto');

  return jsonb_build_object(
    'generado_at', now(),
    'casos', v_casos,
    'resumen', jsonb_build_object(
      'abiertos', (select count(*) from jsonb_array_elements(v_casos) c where c ->> 'estado_caso' = 'abierto'),
      'resueltos', (select count(*) from jsonb_array_elements(v_casos) c where c ->> 'estado_caso' = 'resuelto'),
      'por_incidencia', coalesce((select jsonb_object_agg(t, n) from (select i t, count(*) n from jsonb_array_elements(v_casos) c, jsonb_array_elements_text(c -> 'incidencias') i
                                    where c ->> 'estado_caso' = 'abierto' group by i) z), '{}'::jsonb),
      'nota', 'Un pedido es UN caso; por_incidencia puede sumar más que abiertos (un caso puede tener varias incidencias).',
      'stripe_anomalias', 'no_disponible: sin fuente persistida (llega con PAY-EXP-01A-4)'));
end;
$$;
comment on function public.revision_economica(boolean) is 'PAY-EXP-01A-2 · Revisión económica (solo lectura, Dirección/Facturación): un caso por pedido con incidencias, montos de v_order_money y evidencia.';

revoke all on function public.revision_economica(boolean) from public, anon;
grant execute on function public.revision_economica(boolean) to authenticated;
