-- SEC-C1 (140) · down: restaura EXACTAMENTE las 6 políticas SELECT (md5 de producción), estado_dinero_pedido (0f5bee32…),
-- estado_fiscal_pedido (fd25730a…), efectivo_esperado (8ab12fb7…) y tramo_corte_caja (7559ec67…), con sus comentarios de
-- producción, y elimina los helpers _sec_c1_pos_ve_pedido, _sec_c1_ve_pedido y _sec_c1_pos_ve_movimiento. No toca datos, permisos de tablas ni la política de orders.
-- ⚠️ REABRE F3 en estas superficies: POS vuelve a leer partidas, asientos, declaraciones, reembolsos, cortes y movimientos
-- ajenos, y las RPC vuelven a responder sobre pedidos y cajeros ajenos.
do $pre$ begin
  if md5(pg_get_functiondef('public.estado_dinero_pedido(uuid)'::regprocedure)) <> '7744d815fd05b6d654e6076f9c530b62'
     or md5(pg_get_functiondef('public.estado_fiscal_pedido(uuid)'::regprocedure)) <> '3ea41141a787035a653988d0ca66ccba'
     or md5(pg_get_functiondef('public.efectivo_esperado(date,text,uuid)'::regprocedure)) <> '85db31cc72539b1097166d272887dccc'
     or md5(pg_get_functiondef('public.tramo_corte_caja(date,text,uuid)'::regprocedure)) <> 'fe2088f04d3b6e4d0136a0e084cb06b6'
     or to_regprocedure('public._sec_c1_pos_ve_pedido(uuid)') is null
     or md5(pg_get_functiondef(to_regprocedure('public._sec_c1_pos_ve_pedido(uuid)'))) <> '88173057fc46e7dd94f986aab64c23ca'
     or to_regprocedure('public._sec_c1_ve_pedido(uuid)') is null
     or md5(pg_get_functiondef(to_regprocedure('public._sec_c1_ve_pedido(uuid)'))) <> '7a0a76e0ff4969dff47c5a30c6efee64'
     or to_regprocedure('public._sec_c1_pos_ve_movimiento(uuid)') is null
     or md5(pg_get_functiondef(to_regprocedure('public._sec_c1_pos_ve_movimiento(uuid)'))) <> '14b0f521726efff2be278ccfee165ea6'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'order_items' and policyname = 'order_items_select_scoped') is distinct from 'ade972101e92ee55948b004d0d03cfe3'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'payment_entries' and policyname = 'payment_entries_select_finanzas') is distinct from '172b94d73fdb6f9d4374e9d6dcb0d07e'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'payment_claims' and policyname = 'payment_claims_select_scoped') is distinct from '6355714e576fcd50cdd9bc3a52810b05'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'refunds' and policyname = 'refunds_select') is distinct from 'a3783ee439bf98656dd35f22b74dc246'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'cash_closings' and policyname = 'cash_closings_select_finanzas') is distinct from 'f07a46d9d9ceca9490b7a227394ca50a'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'inventory_movements' and policyname = 'invmov_select_ops') is distinct from 'a57e5032292211476a5a2c9f88c3cf60' then
    raise exception 'SEC-C1 down: el estado instalado no es SEC-C1; no se revierte sobre un estado desconocido';
  end if;
end $pre$;
alter policy order_items_select_scoped on public.order_items using (((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'billing'::text, 'pos'::text])) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.doctor_id = auth.uid()))))));
alter policy payment_entries_select_finanzas on public.payment_entries using ((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'pos'::text])));
alter policy payment_claims_select_scoped on public.payment_claims using (((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'pos'::text])) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = payment_claims.order_id) AND (o.doctor_id = auth.uid()))))));
alter policy refunds_select on public.refunds using ((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'pos'::text])));
alter policy cash_closings_select_finanzas on public.cash_closings using ((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'pos'::text])));
alter policy invmov_select_ops on public.inventory_movements using ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'pos'::text])));
CREATE OR REPLACE FUNCTION public.estado_dinero_pedido(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m record; v_o record;
begin
  select * into v_o from public.orders where id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if not (public.auth_role() = any (array['admin','billing','pos','warehouse','packing'])
          or v_o.doctor_id = auth.uid()) then
    raise exception 'NO_AUTORIZADO';
  end if;
  select * into v_m from public.v_order_money where order_id = p_order;
  return to_jsonb(v_m) || jsonb_build_object(
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'method', c.method,
                                'monto', c.amount_declared, 'declarado', c.declared_at, 'motivo_rechazo', c.reject_reason)
                          order by c.declared_at desc) from public.payment_claims c where c.order_id = p_order), '[]'::jsonb),
    'asientos', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'direction', e.direction, 'method', e.method,
                                'monto', e.amount, 'fecha_valor', e.value_date, 'reversa_de', e.reversal_of)
                          order by e.created_at) from public.payment_entries e where e.order_id = p_order), '[]'::jsonb));
end;
$function$;
CREATE OR REPLACE FUNCTION public.estado_fiscal_pedido(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d public.fiscal_documents; v_role text := public.auth_role();
  v_doctor uuid; v_cust uuid; v_multiple int := 0; v_vence timestamptz;
begin
  select o.doctor_id, o.customer_id into v_doctor, v_cust from public.orders o where o.id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if not (v_role = any (array['admin','billing','pos'])
          or v_doctor = auth.uid()
          or exists (select 1 from public.customers c where c.id = v_cust and c.profile_id = auth.uid())) then
    raise exception 'NO_AUTORIZADO: no puedes consultar el estado fiscal de este pedido';
  end if;

  select * into d from public.fiscal_documents f
   where f.order_id = p_order
   order by (f.status in ('pendiente','en_proceso','timbrado','incierto')) desc, f.created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('status', 'sin_solicitud', 'puede_solicitar', true,
             'puede_reintentar', false, 'requiere_conciliacion', false,
             'requiere_revision_manual', false, 'timbrado_habilitado', false);
  end if;

  select count(*) into v_multiple from public.fiscal_reconciliations r
   where r.fiscal_document_id = d.id and r.outcome = 'multiple';
  v_vence := public._w3_replay_vence(d.provider_date_sent);

  return jsonb_build_object(
    'doc_id', d.id, 'status', d.status, 'uuid', d.uuid,
    'serie', d.serie, 'folio', d.folio,
    'provider_env', d.provider_env, 'attempts', d.attempts,
    'error_code', d.error_code, 'error_message', d.error_message,
    'puede_solicitar',        d.status in ('fallido','cancelado'),
    'puede_reintentar',       d.status = 'fallido',
    'requiere_conciliacion',  d.status = 'incierto',
    'requiere_revision_manual', v_multiple > 0 and d.status = 'incierto',
    -- Reenvío: SOLO dentro de la ventana segura, y nunca como "reintento".
    'replay_vence_en',        v_vence,
    'replay_permitido',       d.status in ('en_proceso','incierto')
                              and v_vence is not null and v_vence > now(),
    -- D-W3-4 sigue abierta: W3-B no habilita la emisión real.
    'timbrado_habilitado',    false,
    'updated_at', d.updated_at);
end;
$function$;
CREATE OR REPLACE FUNCTION public.efectivo_esperado(p_fecha date, p_alcance text DEFAULT 'dia'::text, p_cajero uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cajero uuid := case when p_alcance = 'dia' then null else p_cajero end;
begin
  -- El efectivo en caja es información de caja: no la ve un doctor ni Almacén.
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para consultar el efectivo esperado';
  end if;
  return public._w2_efectivo_tramo(
    public._w2_corte_desde(p_fecha, p_alcance, v_cajero), clock_timestamp(), p_alcance, v_cajero);
end;
$function$;
CREATE OR REPLACE FUNCTION public.tramo_corte_caja(p_fecha date, p_alcance text DEFAULT 'dia'::text, p_cajero uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cajero uuid := case when p_alcance = 'dia' then null else p_cajero end;
        v_desde timestamptz; v_cola public.cash_closings;
begin
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para consultar el corte';
  end if;
  v_cola  := public._w2_corte_cola(p_alcance, v_cajero);
  v_desde := public._w2_corte_desde(p_fecha, p_alcance, v_cajero);
  return jsonb_build_object(
    'desde', v_desde, 'hasta', clock_timestamp(),
    'esperado', public._w2_efectivo_tramo(v_desde, clock_timestamp(), p_alcance, v_cajero),
    'primer_corte', (v_cola.id is null),
    'continua_de', v_cola.id,
    'reabre_anulado', v_cola.voids_closing_id);
end;
$function$;
comment on function public.estado_dinero_pedido(uuid) is null;
comment on function public.efectivo_esperado(date,text,uuid) is null;
comment on function public.tramo_corte_caja(date,text,uuid) is null;
drop function public._sec_c1_pos_ve_movimiento(uuid);
drop function public._sec_c1_ve_pedido(uuid);
drop function public._sec_c1_pos_ve_pedido(uuid);
do $post$ begin
  if md5(pg_get_functiondef('public.estado_dinero_pedido(uuid)'::regprocedure)) <> '0f5bee324f73fe4505a62824674557d8'
     or md5(pg_get_functiondef('public.estado_fiscal_pedido(uuid)'::regprocedure)) <> 'fd25730aaab4572c4e4cffb3fe351312'
     or md5(pg_get_functiondef('public.efectivo_esperado(date,text,uuid)'::regprocedure)) <> '8ab12fb796a7e64eb3e7c093e8fb8e90'
     or md5(pg_get_functiondef('public.tramo_corte_caja(date,text,uuid)'::regprocedure)) <> '7559ec6775f850d70f9a797885fa8b19'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'order_items' and policyname = 'order_items_select_scoped') is distinct from 'e4e98df6bfa86331b7bf996f37e69d48'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'payment_entries' and policyname = 'payment_entries_select_finanzas') is distinct from '1659cc7fac6d1594fbc1f4b61d6b0160'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'payment_claims' and policyname = 'payment_claims_select_scoped') is distinct from 'aca71eb26ba9bd9475887ae97f39eafb'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'refunds' and policyname = 'refunds_select') is distinct from '1659cc7fac6d1594fbc1f4b61d6b0160'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'cash_closings' and policyname = 'cash_closings_select_finanzas') is distinct from '1659cc7fac6d1594fbc1f4b61d6b0160'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'inventory_movements' and policyname = 'invmov_select_ops') is distinct from 'ab9d17be8bde4335fd7540163362d974'
     or to_regprocedure('public._sec_c1_pos_ve_pedido(uuid)') is not null or to_regprocedure('public._sec_c1_ve_pedido(uuid)') is not null
     or to_regprocedure('public._sec_c1_pos_ve_movimiento(uuid)') is not null then
    raise exception 'SEC-C1 down: la restauración no es idéntica a producción';
  end if;
end $post$;
