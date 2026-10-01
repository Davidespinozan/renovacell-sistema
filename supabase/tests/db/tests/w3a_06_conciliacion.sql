-- W3-A · CONCILIACIÓN LOCAL. Detecta lo que se puede detectar sin hablar con el PAC, y
-- REPORTA explícitamente lo que todavía no puede resolver (C4) en vez de callarlo.
-- Base limpia: la conciliación no debe encontrar nada.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_o2 uuid; v_d uuid; v_n int;
begin
  perform tests.act_as(v_admin);
  perform tests.eq(tests.fiscal_errores(), 0, 'base sin actividad fiscal: conciliación limpia');

  -- Una solicitud pendiente y un timbre correcto NO son hallazgos.
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.eq(tests.fiscal_errores(), 0, 'una solicitud pendiente no es un hallazgo');
  perform tests.timbrar(v_d, 'AAAA1111-2222-3333-4444-555566667777', 'produccion');
  perform tests.eq(tests.fiscal_errores(), 0, 'un timbre correcto y proyectado no es un hallazgo');

  -- ── C4 · una intención AMBIGUA se reporta siempre ──────────────────────────
  v_o2 := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o2);
  perform tests.act_as_owner();
  perform public._w3_reclamar(v_d, gen_random_uuid());
  perform public._w3_transicion(v_d, 'incierto', 'incierto', 'en_proceso', 'timeout', null,
    null, null, 'produccion', null, null, null, 'timeout', 'sin respuesta');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C4_incierto_sin_conciliar'), 1,
    'C4: la intención ambigua se reporta como pendiente de conciliar contra el PAC');
  perform tests.ok((select detalle like '%no implementada (W3-B)%' from public.conciliar_cfdi()
                     where check_id = 'C4_incierto_sin_conciliar'),
    'C4: se declara explícitamente que la conciliación externa NO está implementada');
  perform tests.ok(tests.fiscal_errores() > 0, 'un incierto mantiene la conciliación en rojo hasta resolverse');

  -- Al conciliarla, deja de ser hallazgo.
  perform tests.act_as_owner();
  perform public._w3_transicion(v_d, 'fallido', 'conciliacion', 'incierto', 'el PAC no lo tenía', null,
    null, null, null, null, null, null, null, null, null, 'el PAC no registró el comprobante');
  perform tests.act_as(v_admin);
  perform tests.eq(tests.fiscal_errores(), 0, 'resuelta la ambigüedad, la conciliación vuelve a estar limpia');
end $t$;
rollback;

-- ── C3 · reclamo abandonado: se detecta y se pide reclasificar, NO reintentar ───────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.act_as_owner();
  perform public._w3_reclamar(v_d, gen_random_uuid());
  -- Se envejece el reclamo: es lo que pasaría si el proceso muriera a media llamada.
  perform set_config('app.trusted', 'on', true);
  update public.fiscal_documents set claimed_at = now() - interval '2 hours' where id = v_d;
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C3_claim_abandonado'), 1,
    'C3: un reclamo abandonado se detecta');
  perform tests.ok((select detalle like '%NO reintentar%' from public.conciliar_cfdi() where check_id = 'C3_claim_abandonado'),
    'C3: el hallazgo dice explícitamente que NO se reintenta');
end $t$;
rollback;

-- ── C5 · pedido cancelado con comprobante vigente ───────────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.timbrar(v_d, 'BBBB1111-2222-3333-4444-555566667777', 'produccion');
  perform tests.force_status(v_o, 'cancelled');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C5_pedido_cancelado_con_cfdi'), 1,
    'C5: un pedido cancelado con CFDI vigente es un hallazgo (cancelar el pedido NO cancela el CFDI)');
end $t$;
rollback;

-- ── C11 · LEGADO: pedido marcado como timbrado sin documento que lo respalde ────────────
-- Es exactamente el rastro que podía dejar el camino anterior a W3-A.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; r record;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set invoice_requested = true,
         invoice_meta = jsonb_build_object('status', 'timbrada', 'uuid', 'CCCC1111-2222-3333-4444-555566667777')
   where id = v_o;
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C11_timbre_legacy_sin_documento'), 1,
    'C11: un timbre legado sin documento fiscal se detecta');
  perform tests.ok((select detalle like '%adopción manual%' from public.conciliar_cfdi()
                     where check_id = 'C11_timbre_legacy_sin_documento'),
    'C11: el hallazgo pide adopción manual, no autocorrección');
end $t$;
rollback;

-- ── C6 · la proyección nunca queda desfasada del documento ──────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C6_proyeccion_vs_documento'), 0,
    'C6: tras la solicitud, la proyección coincide con el documento');
  perform tests.timbrar(v_d, 'DDDD1111-2222-3333-4444-555566667777');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C6_proyeccion_vs_documento'), 0,
    'C6: tras el timbre tampoco hay desfase (la transición proyecta en la misma transacción)');

  -- Si alguien desfasa la proyección a mano, el check lo ve.
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.orders set invoice_meta = jsonb_set(invoice_meta, '{fiscal,status}', '"pendiente"') where id = v_o;
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C6_proyeccion_vs_documento'), 1,
    'C6: un desfase de la proyección se detecta');
end $t$;
rollback;
