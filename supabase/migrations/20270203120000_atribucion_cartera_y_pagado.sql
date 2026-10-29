-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- AUDITORÍA PRE-OPERACIÓN (28 oct 2026) · dos desconexiones del dinero y la venta:
--
-- 1) VENDEDOR DE LA VENTA. `_cx0c_atribucion` (CX-0c, 8 oct) solo conocía la cartera por PORTAL (`cc_cartera`, por
--    profile_id). La cartera por CLIENTE (`cc_cartera_clientes`, 1,858 asignaciones a Roberto y Alejandra) y las
--    equivalencias Odoo confirmadas por el dueño (`cc_cartera_historica_equivalencias`, 15 oct) llegaron después y nunca
--    se conectaron: una venta a un cliente sin portal (2,170 de 2,172) quedaba "no_resoluble", SIN vendedor → no aparece
--    en Metas y comisiones y el vendedor no ve su propio pedido (RLS por seller_profile_id).
--    Ahora, en orden: cartera del portal → cartera del cliente → vendedor Odoo por equivalencia confirmada. Siempre un
--    vendedor ACTIVO con rol pos; si no hay, el resultado de antes (no_resoluble / sin_asignacion).
--
-- 2) "PENDIENTE DE PAGO" YA PAGADO. El cobro solo actualizaba `payment_status`; `orders.status` seguía en
--    pending_payment hasta que Almacén surtía → el doctor, Ventas, Surtido y la agenda decían "Pendiente de pago" a un
--    pedido pagado, y Ventas/comisiones no lo contaban. `_w2_recalc_payment_status` (lo llaman registrar_cobro,
--    revisar_pago, reversar_asiento y pagar_reembolso) ahora además lleva el estado: pending_payment → paid al quedar
--    pagado; paid → pending_payment si una reversa lo deja sin pagar. Nada más cambia de estado (empacado o después no
--    se toca). Es lo mismo que ya hacía el pago con tarjeta (stripe-webhook) y lo que la pantalla ya asumía.
--
-- 3) EL CHOFER NO VEÍA QUÉ LLEVA: order_items no tenía rama de chofer (orders sí, por is_order_driver) → "0 piezas".
-- 4) AVISOS DEL AUXILIAR: notifications_read comparaba app_role() (packing → warehouse), así que un aviso dirigido a
--    'packing' nunca le llegaba a Blanca. Ahora vale el rol real O el mapeado.
-- 6) PEDIDO NUEVO SIN AVISO: un pedido del portal (o de Ventas) no le avisaba a nadie con permiso de cobrarlo (el doctor
--    no puede insertar avisos). Ahora el servidor avisa a Dirección y al vendedor del pedido al crearlo sin pagar.
-- 7) SOLICITUD SIN VENDEDOR OLVIDADA: agotado el reparto, Dirección recibía UN aviso y la solicitud se quedaba 24 h sin
--    nadie. El evaluador ahora le recuerda a Dirección cada `escalamiento_min` minutos mientras siga sin tomar.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public._cx0c_atribucion'::regproc)) <> 'a63db4247f427b280aa1ab4a65c21fdc' then
    raise exception 'ATRIBUCION-PAGADO: _cx0c_atribucion no es la versión esperada (¿ya aplicada?)';
  end if;
  if md5(pg_get_functiondef('public._w2_recalc_payment_status'::regproc)) <> '05ee561cb0e6ad9a6068e29af798acd5' then
    raise exception 'ATRIBUCION-PAGADO: _w2_recalc_payment_status no es la versión esperada (¿ya aplicada?)';
  end if;
  if md5(pg_get_functiondef('public.cc_atencion_evaluar'::regproc)) <> '905f2f96f8c80a0f78693b46e8087e97' then
    raise exception 'ATRIBUCION-PAGADO: funciones de atención no son la versión esperada';
  end if;
end $pre$;

create or replace function public._cx0c_atribucion(p_customer uuid, p_doctor uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare v_p uuid; v_odoo text; v_seller uuid; v_ok boolean; v_email text; v_previo text;
begin
  if p_customer is not null then
    select c.profile_id, nullif(btrim(c.seller_name), '') into v_p, v_odoo from public.customers c where c.id = p_customer;
  else
    v_p := p_doctor;
  end if;

  -- 1) cartera del portal (persona con cuenta)
  if v_p is not null then
    select k.seller_profile_id into v_seller from public.cc_cartera k where k.profile_id = v_p;
  end if;
  -- 2) cartera del cliente (cuenta comercial, con o sin portal)
  if v_seller is null and p_customer is not null then
    select k.seller_profile_id into v_seller from public.cc_cartera_clientes k where k.customer_id = p_customer;
  end if;
  -- 3) vendedor Odoo de la cuenta, solo por equivalencia confirmada por el dueño
  if v_seller is null and v_odoo is not null then
    select e.seller_profile_id into v_seller from public.cc_cartera_historica_equivalencias e
     where lower(btrim(e.seller_name_odoo)) = lower(v_odoo) limit 1;
  end if;

  if v_seller is not null then
    select coalesce(p.active, false) and p.role_id = 'pos', p.email into v_ok, v_email
      from public.profiles p where p.id = v_seller;
    if coalesce(v_ok, false) then
      return jsonb_build_object('estado', 'cartera', 'seller_profile_id', v_seller, 'seller', v_email);
    end if;
    return jsonb_build_object('estado', 'no_resoluble');   -- vendedor asignado pero inelegible: no cae al cajero
  end if;

  -- Sin vendedor resoluble: igual que CX-0c (Odoo sin equivalencia o comprador con cartera = no_resoluble).
  v_previo := case
    when v_odoo is not null then 'no_resoluble'
    when p_doctor is not null and exists (select 1 from public.cc_cartera k where k.profile_id = p_doctor) then 'no_resoluble'
    else 'sin_asignacion' end;
  return jsonb_build_object('estado', v_previo);
end;
$function$;

create or replace function public._w2_recalc_payment_status(p_order uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_estado text;
begin
  select estado_pago into v_estado from public.v_order_money where order_id = p_order;
  if v_estado is null then return null; end if;
  perform public._w2_trusted(true);
  update public.orders set payment_status = v_estado where id = p_order and payment_status is distinct from v_estado;
  -- El estado del pedido sigue al cobro mientras no se ha surtido.
  update public.orders set status = 'paid' where id = p_order and status = 'pending_payment' and v_estado = 'paid';
  update public.orders set status = 'pending_payment' where id = p_order and status = 'paid' and v_estado <> 'paid';
  perform public._w2_trusted(false);
  return v_estado;
end;
$function$;

alter function public._cx0c_atribucion(uuid, uuid) owner to postgres;
alter function public._w2_recalc_payment_status(uuid) owner to postgres;

-- 3) chofer lee los renglones de SUS pedidos
drop policy if exists order_items_select_scoped on public.order_items;
create policy order_items_select_scoped on public.order_items for select to authenticated using (
  (auth_role() = any (array['admin', 'warehouse', 'packing', 'billing']))
  or ((auth_role() = 'pos') and _sec_c1_ve_pedido(order_id))
  or (auth_role() = 'driver' and is_order_driver(order_id))
  or exists (select 1 from public.orders o where o.id = order_items.order_id and o.doctor_id = auth.uid()));

-- 4) avisos por rol real o mapeado
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  case when user_ids is not null then auth.uid() = any (user_ids)
       else auth_role() <> 'doctor' and (app_role() = 'admin' or roles is null or app_role() = any (roles) or auth_role() = any (roles)) end);

-- 6) aviso de pedido nuevo por cobrar (portal o Ventas; la venta de mostrador nace pagada)
create or replace function public._aviso_pedido_nuevo() returns trigger
 language plpgsql security definer set search_path to 'public' as
$function$
declare v_seller uuid; v_txt text;
begin
  if new.status <> 'pending_payment' then return new; end if;
  v_seller := nullif(new.shipping_meta ->> 'seller_profile_id', '')::uuid;
  v_txt := format('Nuevo pedido %s · %s · por cobrar', coalesce(new.external_ref, 'sin folio'), to_char(coalesce(new.total, 0), 'FM$999,999,990.00'));
  perform public._cc_notificar('pedido_nuevo', null, null, array['admin'], v_txt, 'av_pagos', 'pedido_nuevo:' || new.id::text);
  if v_seller is not null then
    perform public._cc_notificar('pedido_nuevo', null, array[v_seller], null, v_txt, null, 'pedido_nuevo_vendedor:' || new.id::text);
  end if;
  return new;
exception when others then
  raise warning 'aviso de pedido nuevo no emitido: %', sqlerrm;   -- un aviso nunca tumba la venta
  return new;
end;
$function$;
alter function public._aviso_pedido_nuevo() owner to postgres;
revoke all on function public._aviso_pedido_nuevo() from public, anon, authenticated;
drop trigger if exists trg_aviso_pedido_nuevo on public.orders;
create trigger trg_aviso_pedido_nuevo after insert on public.orders for each row execute function public._aviso_pedido_nuevo();

-- 7) recordatorio a Dirección mientras una solicitud siga sin vendedor
create or replace function public.cc_atencion_evaluar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cfg record; hor jsonb; v_conf boolean; r record; n int := 0; n_aviso int := 0; n_esc int := 0; n_rep int := 0; n_agot int := 0; n_cola int := 0; reloj integer; s uuid; v_motivo text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not (public._cc_es_admin() or public._cc_es_service()) then
    raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.cc_atencion_config where id = 1;
  hor := public._cc_horario_estado(now()); v_conf := coalesce((hor ->> 'configurado')::boolean, false);
  if cfg.pausar_fuera_horario and not v_conf then return jsonb_build_object('evaluadas', 0, 'avisos', 0, 'escalaciones', 0, 'repartos', 0, 'agotados', 0, 'omitido', 'horario_sin_configurar'); end if;
  for r in select c.id, c.seller_profile_id, c.asesoria_asignada_at, c.ruteo_motivo, c.profile_id, c.asesoria_solicitada_at from public.cc_conversations c
            where c.estado = 'abierta' and c.modo = 'human_assigned' and c.seller_profile_id is not null and c.asesoria_asignada_at is not null loop
    n := n + 1;
    reloj := case when cfg.pausar_fuera_horario then public._cc_minutos_habiles(r.asesoria_asignada_at, now()) else floor(extract(epoch from (now() - r.asesoria_asignada_at)) / 60)::int end;
    if reloj is null then continue; end if;
    if r.ruteo_motivo = 'reparto' then
      -- REPARTO · nadie la inició en el plazo: pasa al siguiente vendedor que no la haya tenido; agotados, a Dirección.
      if reloj >= cfg.reparto_min then
        s := public._cc_reparto_elegir(r.id);
        if s is not null then
          perform public._cc_reparto_asignar(r.id, s); n_rep := n_rep + 1;
        else
          v_motivo := case when r.profile_id is null then 'visitante' else 'sin_vendedor' end;
          perform public._cc_handler_asignar(r.id, null, 'system', null, 'reparto_agotado', 'reparto');
          update public.cc_conversations set ruteo_motivo = v_motivo, updated_at = now() where id = r.id;
          perform public._cc_evento(r.id, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', v_motivo, 'origen', 'reparto_agotado'));
          perform public._cc_notificar('handoff_sin_vendedor', r.id, null, array['admin'], 'Nadie tomó la solicitud repartida: ' || public._cc_nombre_dueno(r.id), 'av_atencion',
                  'sin_vendedor:' || r.id::text || ':' || coalesce(extract(epoch from r.asesoria_solicitada_at)::bigint::text, 'na') || ':agotado');
          n_agot := n_agot + 1;
        end if;
      end if;
      continue;
    end if;
    if reloj >= cfg.escalamiento_min then
      if public._cc_notificar('handoff_escalado', r.id, null, array['admin'],
           format('Solicitud sin atender %s min hábiles con %s: %s', reloj, public._cc_nombre_perfil(r.seller_profile_id), public._cc_nombre_dueno(r.id)), 'av_atencion',
           'escalacion:' || r.id::text || ':' || extract(epoch from r.asesoria_asignada_at)::bigint::text) = 'emitida' then n_esc := n_esc + 1; end if;
    elsif reloj >= cfg.aviso_min then   -- el recordatorio al vendedor solo ANTES de escalar: escalada, decide Dirección (sin ruido)
      if public._cc_notificar('handoff_aviso', r.id, array[r.seller_profile_id], null,
           format('Recordatorio: %s sigue esperando asesor (%s min)', public._cc_nombre_dueno(r.id), reloj), 'asesorias',
           'aviso:' || r.id::text || ':' || extract(epoch from r.asesoria_asignada_at)::bigint::text) = 'emitida' then n_aviso := n_aviso + 1; end if;
    end if;
  end loop;
  -- EN COLA SIN VENDEDOR (reparto agotado o sin vendedores): Dirección recibe un recordatorio por cada tramo de
  -- escalamiento_min mientras nadie la tome; antes era un solo aviso y la solicitud se vencía sin respuesta.
  for r in select c.id, c.asesoria_solicitada_at from public.cc_conversations c
            where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null and c.asesoria_solicitada_at is not null loop
    reloj := case when cfg.pausar_fuera_horario then public._cc_minutos_habiles(r.asesoria_solicitada_at, now()) else floor(extract(epoch from (now() - r.asesoria_solicitada_at)) / 60)::int end;
    if reloj is null or reloj < greatest(cfg.escalamiento_min, 1) then continue; end if;
    if public._cc_notificar('handoff_escalado', r.id, null, array['admin'],
         format('Sigue esperando asesor (%s min hábiles, sin vendedor): %s', reloj, public._cc_nombre_dueno(r.id)), 'av_atencion',
         'cola:' || r.id::text || ':' || extract(epoch from r.asesoria_solicitada_at)::bigint::text || ':' || (reloj / greatest(cfg.escalamiento_min, 1))::text) = 'emitida' then n_cola := n_cola + 1; end if;
  end loop;
  return jsonb_build_object('evaluadas', n, 'avisos', n_aviso, 'escalaciones', n_esc, 'repartos', n_rep, 'agotados', n_agot, 'en_cola', n_cola);
end;
$function$;
alter function public.cc_atencion_evaluar() owner to postgres;

-- Pedidos ya cobrados que se quedaron en pending_payment (hoy 0 en prod; se deja por si acaso).
select set_config('app.trusted', 'on', true);
update public.orders set status = 'paid' where status = 'pending_payment' and payment_status = 'paid';
select set_config('app.trusted', '', true);

do $post$ begin
  if md5(pg_get_functiondef('public._cx0c_atribucion'::regproc)) = 'a63db4247f427b280aa1ab4a65c21fdc' then
    raise exception 'ATRIBUCION-PAGADO: la atribución no cambió';
  end if;
end $post$;
