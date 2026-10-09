-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-C1 (migración 140) · CX-SEC-01 / F3 · AISLAMIENTO DE LECTURAS DE PEDIDOS, DINERO Y CAJA PARA POS
--   Hallazgo (auditado y reproducido en cluster desechable): orders sí estaba acotado para POS, pero sus tablas hijas y
--   varias RPC no: POS leía TODAS las partidas, asientos, declaraciones, reembolsos, cortes y movimientos, y las RPC
--   estado_dinero_pedido / estado_fiscal_pedido / efectivo_esperado / tramo_corte_caja respondían sobre pedidos y cajeros
--   ajenos. Con eso un POS sin relación reconstruía un pedido ajeno completo (F3-J).
--   Invariante: para POS, lo que se ve de una tabla hija o de una RPC nunca excede lo que se ve del pedido en orders.
--     · RLS: POS ⇒ _sec_c1_ve_pedido(order_id) (SQL INVOKER = el RLS de orders del que consulta; sin recursión: la política
--       de orders no lee tablas hijas); movimientos ⇒ _sec_c1_pos_ve_movimiento(id) (sin depender de la columna order_id).
--     · RPC SECURITY DEFINER: _sec_c1_pos_ve_pedido (cláusula POS de orders_select_scoped, sin cambios en la política).
--     · Cortes y arqueo: POS solo su propio corte de cajero (auth.uid()).
--   Fuera de alcance (C2–C5): vistas de custodia, directorios, clientes/ubicaciones, columnas de costo (unit_cost).
--   Sin cambios de datos, escrituras, permisos de tablas ni de la política de orders. Rollback: supabase/rollback/sec_c1/99_down.sql
--   (REABRE F3 para estas superficies).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public.estado_dinero_pedido(uuid)'::regprocedure)) <> '0f5bee324f73fe4505a62824674557d8'
     or md5(pg_get_functiondef('public.estado_fiscal_pedido(uuid)'::regprocedure)) <> 'fd25730aaab4572c4e4cffb3fe351312'
     or md5(pg_get_functiondef('public.efectivo_esperado(date,text,uuid)'::regprocedure)) <> '8ab12fb796a7e64eb3e7c093e8fb8e90'
     or md5(pg_get_functiondef('public.tramo_corte_caja(date,text,uuid)'::regprocedure)) <> '7559ec6775f850d70f9a797885fa8b19'
     or md5(pg_get_functiondef('public.pedido_visible(uuid)'::regprocedure)) <> 'dd2c4bfe38132e221e0860ecc77e2020'
     or md5(pg_get_functiondef('public._cx0c_venta_pos_propia(uuid)'::regprocedure)) <> 'd367994ba8540919115663de4605825a'
     or md5(pg_get_functiondef('public.order_vendor_email(uuid)'::regprocedure)) <> '58a350df9c9582768d78a0ec1de00dde' then
    raise exception 'SEC-C1: las funciones de lectura no son la versión esperada (ya aplicada o drift en producción)';
  end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'order_items' and policyname = 'order_items_select_scoped' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from 'e4e98df6bfa86331b7bf996f37e69d48'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'payment_entries' and policyname = 'payment_entries_select_finanzas' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from '1659cc7fac6d1594fbc1f4b61d6b0160'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'payment_claims' and policyname = 'payment_claims_select_scoped' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from 'aca71eb26ba9bd9475887ae97f39eafb'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'refunds' and policyname = 'refunds_select' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from '1659cc7fac6d1594fbc1f4b61d6b0160'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'cash_closings' and policyname = 'cash_closings_select_finanzas' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from '1659cc7fac6d1594fbc1f4b61d6b0160'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'inventory_movements' and policyname = 'invmov_select_ops' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from 'ab9d17be8bde4335fd7540163362d974'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from '457f39b6ea229576071c7c7f4f4a389d' then
    raise exception 'SEC-C1: las políticas SELECT no son las esperadas (drift)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('order_items','payment_entries','payment_claims','refunds','cash_closings','inventory_movements') and cmd in ('SELECT','ALL')) <> 6
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('order_items','payment_entries','payment_claims','refunds','cash_closings','inventory_movements') and permissive <> 'PERMISSIVE') then
    raise exception 'SEC-C1: hay políticas de lectura adicionales o restrictivas no auditadas';
  end if;
  if to_regprocedure('public._sec_c1_pos_ve_pedido(uuid)') is not null or to_regprocedure('public._sec_c1_ve_pedido(uuid)') is not null
     or to_regprocedure('public._sec_c1_pos_ve_movimiento(uuid)') is not null then raise exception 'SEC-C1: los helpers ya existen'; end if;
end $pre$;

-- Helper INTERNO: ¿el usuario POS (auth.uid() / correo del JWT) puede VER este pedido? Es, literalmente, la cláusula POS de
-- orders_select_scoped (CX-0c): vendedor comercial por id; vendedor heredado por correo SOLO si no hay id; ruta heredada
-- meta.owner del doctor (SEC-A); autor de la venta de mostrador (CX-0c-R1). No usa equivalencias ni vendedores de Odoo.
-- Lo usan funciones SECURITY DEFINER (que no pueden apoyarse en el RLS de orders); NO se expone por la API.
create function public._sec_c1_pos_ve_pedido(o_id uuid) returns boolean
  language sql stable set search_path = public as
$$ select auth.uid() is not null and exists (
     select 1 from public.orders o
      where o.id = o_id
        and (   (o.shipping_meta ->> 'seller_profile_id') = (auth.uid())::text
             or ((o.shipping_meta ->> 'seller_profile_id') is null and (o.shipping_meta ->> 'seller') = (auth.jwt() ->> 'email'))
             or public.order_vendor_email(o.id) = (auth.jwt() ->> 'email')
             or public._cx0c_venta_pos_propia(o.id))) $$;
revoke all on function public._sec_c1_pos_ve_pedido(uuid) from public, anon, authenticated, service_role;
comment on function public._sec_c1_pos_ve_pedido(uuid) is
  'SEC-C1 · Cláusula POS de orders_select_scoped como función (para RPC SECURITY DEFINER). Interna: sin EXECUTE para la API. Debe permanecer equivalente a la política (test sec_c1_00).';

-- Helper de POLÍTICA: ¿el que consulta VE este pedido? Mismo cuerpo que pedido_visible (SQL INVOKER ⇒ se evalúa con el RLS de
-- orders del que consulta; sin recursión: orders no lee tablas hijas). Función propia para que las políticas no dependan
-- (pg_depend) de pedido_visible, que el rollback de CC-0A elimina. EXECUTE para authenticated: el RLS la evalúa como el
-- usuario; no revela nada que su propio SELECT sobre orders no muestre.
create function public._sec_c1_ve_pedido(o_id uuid) returns boolean
  language sql stable set search_path = public as
$$ select exists (select 1 from public.orders o where o.id = o_id) $$;
revoke all on function public._sec_c1_ve_pedido(uuid) from public, anon;
grant execute on function public._sec_c1_ve_pedido(uuid) to authenticated, service_role;
comment on function public._sec_c1_ve_pedido(uuid) is
  'SEC-C1 · Para políticas: ¿el que consulta ve el pedido? (RLS de orders, invoker). Igual a pedido_visible, sin dependencia de él.';

-- Helper de POLÍTICA de inventory_movements: ¿el movimiento pertenece a un pedido que este POS puede ver? SECURITY DEFINER para
-- leer el order_id del movimiento sin evaluar de nuevo el RLS de inventory_movements (evita recursión) y sin que la política
-- dependa de la columna order_id (que el rollback de W1 elimina). Solo se usa tras auth_role() = 'pos' en la política.
create function public._sec_c1_pos_ve_movimiento(m_id uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select public._sec_c1_pos_ve_pedido(m.order_id) from public.inventory_movements m
                     where m.id = m_id and m.order_id is not null), false) $$;
revoke all on function public._sec_c1_pos_ve_movimiento(uuid) from public, anon;
grant execute on function public._sec_c1_pos_ve_movimiento(uuid) to authenticated, service_role;
comment on function public._sec_c1_pos_ve_movimiento(uuid) is
  'SEC-C1 · Para la política de inventory_movements: el movimiento es de un pedido que el POS puede ver (_sec_c1_pos_ve_pedido).';

-- ── Políticas SELECT: POS solo ve filas hijas de pedidos que puede VER (_sec_c1_ve_pedido = RLS de orders del que consulta) ──
alter policy order_items_select_scoped on public.order_items using (
  (auth_role() = any (array['admin','warehouse','packing','billing']))
  or ((auth_role() = 'pos') and _sec_c1_ve_pedido(order_id))
  or (exists (select 1 from orders o where o.id = order_items.order_id and o.doctor_id = auth.uid())));
alter policy payment_entries_select_finanzas on public.payment_entries using (
  (auth_role() = any (array['admin','billing']))
  or ((auth_role() = 'pos') and _sec_c1_ve_pedido(order_id)));
alter policy payment_claims_select_scoped on public.payment_claims using (
  (auth_role() = any (array['admin','billing']))
  or ((auth_role() = 'pos') and _sec_c1_ve_pedido(order_id))
  or (exists (select 1 from orders o where o.id = payment_claims.order_id and o.doctor_id = auth.uid())));
-- Reembolsos: ninguna pantalla POS los consulta → POS sin lectura.
alter policy refunds_select on public.refunds using (auth_role() = any (array['admin','billing']));
-- Cortes: POS solo SUS cortes de cajero (incluye su cadena y sus anulaciones); nunca el del día ni el de otro cajero.
alter policy cash_closings_select_finanzas on public.cash_closings using (
  (auth_role() = any (array['admin','billing']))
  or ((auth_role() = 'pos') and (cajero = auth.uid())));
-- Movimientos: POS solo los de pedidos que puede ver. ⚠ unit_cost sigue visible en esas filas hasta C5 (D-SECC-3).
alter policy invmov_select_ops on public.inventory_movements using (
  (auth_role() = any (array['admin','warehouse','packing']))
  or ((auth_role() = 'pos') and _sec_c1_pos_ve_movimiento(id)));

CREATE OR REPLACE FUNCTION public.estado_dinero_pedido(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m record; v_o record; v_existe boolean; v_global boolean := public.auth_role() = any (array['admin','billing','warehouse','packing']);
begin
  select * into v_o from public.orders where id = p_order;
  v_existe := found;
  -- SEC-C1: POS solo ve el estado de un pedido que puede VER (misma regla que orders_select_scoped, vía
  -- _sec_c1_pos_ve_pedido); quien no tiene visibilidad global recibe el MISMO error para ajeno e inexistente.
  if not v_existe and v_global then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if not v_existe or not (v_global
          or (public.auth_role() = 'pos' and public._sec_c1_pos_ve_pedido(p_order))
          or coalesce(v_o.doctor_id = auth.uid(), false)) then      -- NULL-safe: pedido de mostrador sin doctor
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
  -- SEC-C1: POS solo consulta pedidos que puede VER (_sec_c1_pos_ve_pedido = cláusula POS de orders_select_scoped);
  -- sin visibilidad global, ajeno e inexistente dan el MISMO error.
  if not found then
    if v_role = any (array['admin','billing']) then raise exception 'PEDIDO_INEXISTENTE'; end if;
    raise exception 'NO_AUTORIZADO: no puedes consultar el estado fiscal de este pedido';
  end if;
  if not (v_role = any (array['admin','billing'])
          or (v_role = 'pos' and public._sec_c1_pos_ve_pedido(p_order))
          or coalesce(v_doctor = auth.uid(), false)              -- NULL-safe: antes un pedido sin doctor dejaba pasar a cualquiera
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
  -- SEC-C1 · POS solo consulta SU propio corte de cajero (alcance 'cajero' y cajero = identidad autenticada); el cajero
  -- que manda el cliente no se cree. Va antes de calcular nada.
  if public.auth_role() = 'pos'
     and (p_alcance is distinct from 'cajero' or p_cajero is null or p_cajero is distinct from auth.uid()) then
    raise exception 'NO_AUTORIZADO: solo puedes consultar tu propio corte de cajero';
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
  -- SEC-C1 · POS solo consulta SU propio corte de cajero (alcance 'cajero' y cajero = identidad autenticada); el cajero
  -- que manda el cliente no se cree. Va antes de calcular nada.
  if public.auth_role() = 'pos'
     and (p_alcance is distinct from 'cajero' or p_cajero is null or p_cajero is distinct from auth.uid()) then
    raise exception 'NO_AUTORIZADO: solo puedes consultar tu propio corte de cajero';
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

comment on function public.estado_dinero_pedido(uuid) is 'SEC-C1 · Estado de dinero: global para Dirección/Facturación/Almacén/Empaque; POS solo pedidos que puede ver; doctor el suyo. Sin visibilidad global, ajeno = inexistente.';
comment on function public.efectivo_esperado(date,text,uuid) is 'SEC-C1 · Arqueo: Dirección/Facturación cualquier alcance; POS solo su propio corte de cajero.';
comment on function public.tramo_corte_caja(date,text,uuid) is 'SEC-C1 · Tramo del corte: Dirección/Facturación cualquier alcance; POS solo su propio corte de cajero.';

do $post$
declare f regprocedure;
begin
  -- políticas: una SELECT permisiva por tabla, para authenticated; POS ya no está en ningún arreglo de rol global
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('order_items','payment_entries','payment_claims','refunds','cash_closings','inventory_movements')
        and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') <> 6
     or (select count(*) from pg_policies where schemaname = 'public' and tablename in ('order_items','payment_entries','payment_claims','refunds','cash_closings','inventory_movements') and cmd in ('SELECT','ALL')) <> 6 then
    raise exception 'SEC-C1: cambió el conjunto de políticas de lectura';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('order_items','payment_entries','payment_claims','refunds','cash_closings','inventory_movements')
             and qual ~ '''pos''::text\]') then
    raise exception 'SEC-C1: POS sigue con lectura global en alguna tabla';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('order_items','payment_entries','payment_claims') and qual ~ '_sec_c1_ve_pedido\(order_id\)') <> 3
     or (select qual !~ '_sec_c1_pos_ve_movimiento\(id\)' from pg_policies where schemaname = 'public' and tablename = 'inventory_movements')
     or (select qual !~ 'cajero = auth\.uid\(\)' from pg_policies where schemaname = 'public' and tablename = 'cash_closings')
     or (select qual ~ '''pos''' from pg_policies where schemaname = 'public' and tablename = 'refunds') then
    raise exception 'SEC-C1: las políticas nuevas no tienen la forma esperada';
  end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped') <> '457f39b6ea229576071c7c7f4f4a389d' then
    raise exception 'SEC-C1: cambió orders_select_scoped (no permitido; el helper debe seguir equivalente)';
  end if;
  -- funciones: misma forma y permisos
  foreach f in array array['public.estado_dinero_pedido(uuid)'::regprocedure, 'public.estado_fiscal_pedido(uuid)'::regprocedure,
                           'public.efectivo_esperado(date,text,uuid)'::regprocedure, 'public.tramo_corte_caja(date,text,uuid)'::regprocedure] loop
    if (select prosecdef and provolatile = 's' and proconfig = array['search_path=public'] and proowner = 'postgres'::regrole from pg_proc where oid = f) is not true
       or not has_function_privilege('authenticated', f, 'EXECUTE') or not has_function_privilege('service_role', f, 'EXECUTE')
       or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'SEC-C1: cambió la forma o los permisos de %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._sec_c1_pos_ve_pedido(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public._sec_c1_pos_ve_pedido(uuid)', 'EXECUTE')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = 'public._sec_c1_pos_ve_pedido(uuid)'::regprocedure and a.grantee = 0) then
    raise exception 'SEC-C1: el helper interno quedó expuesto por la API';
  end if;
  if has_function_privilege('anon', 'public._sec_c1_ve_pedido(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public._sec_c1_pos_ve_movimiento(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public._sec_c1_ve_pedido(uuid)', 'EXECUTE') or not has_function_privilege('authenticated', 'public._sec_c1_pos_ve_movimiento(uuid)', 'EXECUTE') then
    raise exception 'SEC-C1: permisos inesperados en los helpers de política';
  end if;
end $post$;
