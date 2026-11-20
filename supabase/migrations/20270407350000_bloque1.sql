-- BLOQUE 1 (20 nov 2026, dueño: «DALE»). Cierra los huecos que quedaron de las auditorías por rol.
--   A. Cobro del chofer: el 2º cobro en efectivo del mismo chofer fallaba (la leyenda iba en external_ref, que es único).
--   B. Corte de efectivo del chofer: Dirección/Facturación RECIBE el efectivo que trae el chofer (corte de cajero con el
--      chofer como cajero, cadena de cortes existente). El chofer ve cuánto trae. El corte del DÍA ya no espera el efectivo
--      del chofer mientras no lo entregue: lo cuenta en el momento en que la oficina lo recibe.
--   C. Pedido rechazado: «Regresó al almacén» (el envío se cierra, el pedido vuelve a Surtido para asignar otro chofer) y
--      «Cambiar chofer» sobre un envío vivo.
--   D. Cancelar un pedido con factura vigente: se bloquea con un mensaje que dice cómo cancelar primero el CFDI.
--   E. «Eliminar doctor» (estaba bloqueado a propósito: los doctores no se borran): ahora es «Dar de baja».
--   F. Alertas de errores: los errores de la app se guardan agrupados y Dirección recibe aviso de cada error NUEVO.

-- ============================================================================ pre-guards
do $pre$ begin
  if position('v_entry := public._w2_asiento(p_op_id, s.order_id, ''in'', p_metodo, round(p_monto, 2), public.hoy_local(), null, null, v_ref, null, null);'
              in pg_get_functiondef('public.registrar_cobro_entrega(uuid,uuid,text,numeric,text)'::regprocedure)) = 0
     or position('  if v_cola.id is null then
    -- Primer corte del alcance: desde el inicio del periodo operativo (día local).' in pg_get_functiondef('public._w2_corte_desde(date,text,uuid)'::regprocedure)) = 0
     or position('  if v_o.status not in (''draft'',''pending_payment'',''paid'',''picking'',''packed'') then
    raise exception ''ESTADO_INVALIDO: %'', v_o.status;
  end if;' in pg_get_functiondef('public.cancelar_pedido(uuid,uuid,text)'::regprocedure)) = 0
     or position('''link_pago'' then ''💳 Te piden link de pago'' else' in pg_get_functiondef('public.aviso_push_carga(uuid)'::regprocedure)) = 0 then
    raise exception 'BLOQUE1: cambiaron las funciones; revisar los parches';
  end if;
end $pre$;

-- ============================================================================ A + B (parches)
do $patch$
declare d text;
begin
  -- A. la leyenda va en notas; la referencia de transferencia (si la hay) no se usa como llave única
  d := pg_get_functiondef('public.registrar_cobro_entrega(uuid,uuid,text,numeric,text)'::regprocedure);
  d := replace(d, 'v_entry := public._w2_asiento(p_op_id, s.order_id, ''in'', p_metodo, round(p_monto, 2), public.hoy_local(), null, null, v_ref, null, null);',
                  'v_entry := public._w2_asiento(p_op_id, s.order_id, ''in'', p_metodo, round(p_monto, 2), public.hoy_local(), null, null, null, null, null, null, v_ref);   -- BLOQUE1: leyenda en notas');
  execute d;

  -- B. el primer corte de un CHOFER abarca todo lo que haya cobrado (no solo el día)
  d := pg_get_functiondef('public._w2_corte_desde(date,text,uuid)'::regprocedure);
  d := replace(d, '  if v_cola.id is null then
    -- Primer corte del alcance: desde el inicio del periodo operativo (día local).',
'  if v_cola.id is null and p_alcance = ''cajero'' and exists (select 1 from public.profiles pr where pr.id = p_cajero and pr.role_id = ''driver'') then
    return timestamptz ''2026-01-01 00:00:00-07'';   -- BLOQUE1 · chofer: todo lo cobrado desde siempre
  end if;
  if v_cola.id is null then
    -- Primer corte del alcance: desde el inicio del periodo operativo (día local).');
  execute d;
end $patch$;

-- B. Corte del DÍA: el efectivo del chofer cuenta cuando la oficina lo RECIBE (corte del chofer), no cuando lo cobra.
create or replace function public._w2_efectivo_tramo(p_desde timestamptz, p_hasta timestamptz, p_alcance text, p_cajero uuid)
returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce((
    select sum(case when e.direction = 'in' then e.amount else -e.amount end)
      from public.payment_entries e
     where e.method = 'efectivo'
       and e.created_at >  p_desde
       and e.created_at <= p_hasta
       and (case when p_alcance = 'dia' then e.actor_role is distinct from 'driver'          -- BLOQUE1
                 else e.recorded_by is not distinct from p_cajero end)), 0)
  + case when p_alcance = 'dia' then coalesce((
    select sum(c.contado)
      from public.cash_closings c
      join public.profiles pr on pr.id = c.cajero and pr.role_id = 'driver'
     where c.alcance = 'cajero' and c.voids_closing_id is null
       and c.corte_hasta >  p_desde
       and c.corte_hasta <= p_hasta
       and not exists (select 1 from public.cash_closings v where v.voids_closing_id = c.id)), 0)
    else 0 end;
$function$;

-- B. El chofer: cuánto efectivo trae (desde su última entrega a la oficina).
create or replace function public.mi_efectivo_chofer()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_desde timestamptz; v_ult public.cash_closings;
begin
  if public.auth_role() <> 'driver' then raise exception 'NO_AUTORIZADO: solo el chofer' using errcode = 'insufficient_privilege'; end if;
  v_desde := public._w2_corte_desde(public.hoy_local(), 'cajero', v_uid);
  v_ult := public._w2_corte_cola('cajero', v_uid);
  return jsonb_build_object(
    'pendiente', public._w2_efectivo_tramo(v_desde, clock_timestamp(), 'cajero', v_uid),
    'desde', v_desde,
    'ultima_entrega', case when v_ult.id is not null and v_ult.voids_closing_id is null then jsonb_build_object('at', v_ult.corte_hasta, 'contado', v_ult.contado) end,
    'cobros', coalesce((select jsonb_agg(jsonb_build_object('folio', coalesce(o.external_ref, ''), 'monto', e.amount, 'at', e.created_at) order by e.created_at)
                          from public.payment_entries e left join public.orders o on o.id = e.order_id
                         where e.method = 'efectivo' and e.direction = 'in' and e.recorded_by = v_uid
                           and e.created_at > v_desde), '[]'::jsonb));
end;
$function$;

-- B. Oficina: efectivo que trae cada chofer.
create or replace function public.efectivo_choferes()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not (public.auth_role() = any (array['admin','billing'])) then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'nombre') from (
      select jsonb_build_object('driver_id', p.id, 'nombre', coalesce(nullif(btrim(p.full_name), ''), p.email),
               'pendiente', public._w2_efectivo_tramo(d.desde, clock_timestamp(), 'cajero', p.id),
               'cobros', (select count(*) from public.payment_entries e where e.method = 'efectivo' and e.direction = 'in' and e.recorded_by = p.id and e.created_at > d.desde),
               'desde', d.desde) as x
        from public.profiles p
        cross join lateral (select public._w2_corte_desde(public.hoy_local(), 'cajero', p.id) as desde) d
       where p.role_id = 'driver' and p.active and not coalesce(p.interna, false)) s), '[]'::jsonb);
end;
$function$;

-- B. Oficina RECIBE el efectivo del chofer: corte de cajero con el chofer como cajero (misma cadena y reglas).
create or replace function public.recibir_efectivo_chofer(p_op_id uuid, p_driver uuid, p_contado numeric, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_res jsonb; v_nombre text;
begin
  if not (public.auth_role() = any (array['admin','billing'])) then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación reciben el efectivo' using errcode = 'insufficient_privilege'; end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_nombre from public.profiles where id = p_driver and role_id = 'driver';
  if v_nombre is null then raise exception 'CHOFER_INEXISTENTE: ese usuario no es chofer' using errcode = 'check_violation'; end if;
  v_res := public.registrar_corte_caja(p_op_id, public.hoy_local(), 'cajero', 0, p_contado, p_motivo, p_driver);
  if v_res->>'status' = 'applied' then
    perform public._cc_notificar('efectivo_chofer', null, array[p_driver], null,
      format('La oficina recibió tu efectivo: %s.', to_char(p_contado, 'FM$999,999,990.00')), 'driver_home',
      'efectivo_recibido:' || (v_res->>'closing_id'));
  end if;
  return v_res;
end;
$function$;

-- ============================================================================ C. envíos: regresar al almacén / cambiar chofer
create or replace function public.envio_regreso_almacen(p_shipment uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s public.shipments; o public.orders;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then raise exception 'NO_AUTORIZADO: solo Almacén o Dirección' using errcode = 'insufficient_privilege'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO: escribe por qué regresó' using errcode = 'check_violation'; end if;
  select * into s from public.shipments where id = p_shipment for update;
  if not found then raise exception 'ENVIO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if s.status not in ('despachado','out_for_delivery','incident') then
    raise exception 'ENVIO_NO_EN_RUTA: ese envío no está en ruta (%)', s.status using errcode = 'check_violation'; end if;
  if s.driver_id is null then raise exception 'ENVIO_PAQUETERIA: los envíos por paquetería se gestionan con la paquetería' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.payment_entries e where e.order_id = s.order_id and e.actor_role = 'driver' and e.direction = 'in') then
    raise exception 'COBRADO_POR_CHOFER: el chofer ya registró un cobro de este pedido; revísalo con Dirección antes de regresarlo' using errcode = 'check_violation'; end if;
  select * into o from public.orders where id = s.order_id for update;
  perform set_config('app.trusted', 'on', true);
  update public.shipments
     set status = 'cancelado',
         incident = coalesce(incident, '{}'::jsonb) || jsonb_build_object('resolved', true, 'regreso_almacen', true,
                      'motivo', left(btrim(p_motivo), 300), 'regreso_at', now(), 'regreso_por', auth.uid())
   where id = p_shipment;
  if o.status = 'shipped' then update public.orders set status = 'packed' where id = o.id; end if;
  perform set_config('app.trusted', 'off', true);
  insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
  values (auth.uid(), 'Pedido regresó al almacén', 'shipments', p_shipment::text,
          jsonb_build_object('folio', o.external_ref, 'motivo', left(btrim(p_motivo), 300), 'chofer', s.driver_id));
  perform public._cc_notificar('envio_regreso', null, null, array['admin','warehouse'],
    format('%s regresó al almacén: %s. Asígnale chofer de nuevo en Surtido.', coalesce(o.external_ref, 'Un pedido'), left(btrim(p_motivo), 120)),
    'despacho', 'envio_regreso:' || p_shipment::text);
  return jsonb_build_object('status', 'applied', 'order_id', o.id, 'order_status', case when o.status = 'shipped' then 'packed' else o.status end);
end;
$function$;

create or replace function public.envio_cambiar_chofer(p_shipment uuid, p_driver uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s public.shipments; v_folio text; v_nombre text;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then raise exception 'NO_AUTORIZADO: solo Almacén o Dirección' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.shipments where id = p_shipment for update;
  if not found then raise exception 'ENVIO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if s.status not in ('por_despachar','despachado','out_for_delivery','incident') then
    raise exception 'ENVIO_CERRADO: ese envío ya no se puede reasignar (%)', s.status using errcode = 'check_violation'; end if;
  if s.driver_id is null then raise exception 'ENVIO_PAQUETERIA: los envíos por paquetería no llevan chofer' using errcode = 'check_violation'; end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_nombre from public.profiles where id = p_driver and role_id = 'driver' and active;
  if v_nombre is null then raise exception 'CHOFER_INVALIDO: elige un chofer activo' using errcode = 'check_violation'; end if;
  if p_driver = s.driver_id then return jsonb_build_object('status', 'already_applied'); end if;
  select external_ref into v_folio from public.orders where id = s.order_id;
  update public.shipments
     set driver_id = p_driver,
         status = case when status = 'por_despachar' then 'por_despachar' else 'despachado' end,
         load_confirmed_at = case when status = 'por_despachar' then load_confirmed_at else null end,
         incident = case when incident is null then null else incident || jsonb_build_object('resolved', true, 'reasignado_at', now()) end
   where id = p_shipment;
  insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
  values (auth.uid(), 'Chofer cambiado', 'shipments', p_shipment::text, jsonb_build_object('folio', v_folio, 'antes', s.driver_id, 'ahora', p_driver));
  perform public._cc_notificar('envio_chofer', null, array[p_driver], null,
    format('Te asignaron la entrega %s.', coalesce(v_folio, '')), 'driver_home', 'envio_chofer:' || p_shipment::text || ':' || p_driver::text);
  if s.driver_id is not null then
    perform public._cc_notificar('envio_chofer', null, array[s.driver_id], null,
      format('La entrega %s se pasó a %s; ya no la llevas tú.', coalesce(v_folio, ''), v_nombre), 'driver_home', 'envio_chofer_quitado:' || p_shipment::text || ':' || s.driver_id::text);
  end if;
  return jsonb_build_object('status', 'applied', 'driver', v_nombre);
end;
$function$;

-- ============================================================================ D. no cancelar un pedido con factura vigente
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.cancelar_pedido(uuid,uuid,text)'::regprocedure);
  d := replace(d, '  if v_o.status not in (''draft'',''pending_payment'',''paid'',''picking'',''packed'') then
    raise exception ''ESTADO_INVALIDO: %'', v_o.status;
  end if;',
'  if v_o.status not in (''draft'',''pending_payment'',''paid'',''picking'',''packed'') then
    raise exception ''ESTADO_INVALIDO: %'', v_o.status;
  end if;
  -- BLOQUE1 · factura vigente: primero se cancela el CFDI (Facturación → Cancelar CFDI), luego el pedido.
  if coalesce(v_o.invoice_meta -> ''cancel'' ->> ''status'', '''') <> ''cancelada''
     and (exists (select 1 from public.fiscal_documents fd where fd.order_id = p_order and fd.kind = ''ingreso''
                   and fd.status in (''timbrado'',''en_proceso'',''incierto''))
          or (v_o.invoice_meta ->> ''status'' = ''timbrada'' and coalesce(v_o.invoice_meta ->> ''simulated'', ''false'') <> ''true'')) then
    raise exception ''CFDI_VIGENTE: el pedido % tiene factura vigente. Primero cancela la factura en Facturación (Cancelar CFDI) y después el pedido'',
      coalesce(v_o.external_ref, p_order::text) using errcode = ''check_violation'';
  end if;');
  execute d;
end $patch$;

-- ============================================================================ E. dar de baja a un doctor
create or replace function public.doctor_dar_de_baja(p_profile uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v public.profiles; v_marca jsonb;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección da de baja a un doctor' using errcode = 'insufficient_privilege'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO: escribe por qué se da de baja' using errcode = 'check_violation'; end if;
  select * into v from public.profiles where id = p_profile;
  if not found or v.role_id is distinct from 'doctor' then raise exception 'DOCTOR_INEXISTENTE: ese usuario no es doctor' using errcode = 'check_violation'; end if;
  if not v.active then return jsonb_build_object('status', 'already_applied'); end if;
  v_marca := jsonb_build_object('motivo', left(btrim(p_motivo), 400), 'at', now(), 'por', auth.uid(), 'baja', true);
  perform set_config('app.trusted', 'on', true);
  update public.profiles
     set active = false, verified = false,
         meta = coalesce(meta, '{}'::jsonb)
                || jsonb_build_object('baja', v_marca,
                     'verification', coalesce(meta -> 'verification', '{}'::jsonb)
                        || jsonb_build_object('status', 'revoked', 'reviewed_at', now(), 'reviewed_by', 'Administración', 'reason', left(btrim(p_motivo), 400)))
   where id = p_profile;
  perform set_config('app.trusted', 'off', true);
  insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
  values (auth.uid(), 'Doctor dado de baja', 'profiles', p_profile::text,
          jsonb_build_object('nombre', coalesce(v.full_name, v.email), 'motivo', left(btrim(p_motivo), 400)));
  return jsonb_build_object('status', 'applied');
end;
$function$;

-- ============================================================================ F. alertas de errores
create table if not exists public.errores_app (
  id uuid primary key default gen_random_uuid(),
  huella text not null unique,
  origen text not null check (origen in ('cliente','escritura','edge')),
  mensaje text not null,
  ruta text,
  rol text,
  ultimo_usuario uuid,
  n integer not null default 1,
  primera timestamptz not null default now(),
  ultima timestamptz not null default now()
);
alter table public.errores_app enable row level security;
revoke all on public.errores_app from anon, authenticated;
grant select on public.errores_app to authenticated;
drop policy if exists errores_app_admin on public.errores_app;
create policy errores_app_admin on public.errores_app for select to authenticated using (public.auth_role() = 'admin');

create or replace function public.registrar_error(p_origen text, p_mensaje text, p_ruta text default null, p_huella text default null)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare v_huella text; v_nuevo boolean; v_rol text := public.auth_role(); v_msg text; v_n int;
begin
  if auth.uid() is null and not public._cc_es_service() then return 'ignorado'; end if;
  if p_origen not in ('cliente','escritura','edge') or nullif(btrim(p_mensaje), '') is null then return 'ignorado'; end if;
  v_msg := left(btrim(p_mensaje), 300);
  v_huella := left(coalesce(nullif(btrim(p_huella), ''), md5(p_origen || '|' || regexp_replace(v_msg, '[0-9a-f-]{8,}|\d+', '#', 'gi') || '|' || coalesce(p_ruta, ''))), 64);
  -- freno: un mismo error cuenta a lo más una vez cada 10 s
  update public.errores_app set n = n + 1, ultima = now(), ultimo_usuario = auth.uid(), rol = coalesce(nullif(v_rol, ''), rol)
   where huella = v_huella and ultima < now() - interval '10 seconds'
  returning n into v_n;
  if found then
    if v_n in (25, 100, 500) then
      perform public._cc_notificar('error_app', null, null, array['admin'],
        format('Error repetido %s veces: %s', v_n, left(v_msg, 160)), 'sistema_errores', 'error_rep:' || v_huella || ':' || v_n);
    end if;
    return 'contado';
  end if;
  if exists (select 1 from public.errores_app where huella = v_huella) then return 'frenado'; end if;
  if (select count(*) from public.errores_app where primera > now() - interval '1 hour') >= 200 then return 'tope'; end if;
  insert into public.errores_app (huella, origen, mensaje, ruta, rol, ultimo_usuario)
  values (v_huella, p_origen, v_msg, left(p_ruta, 200), nullif(v_rol, ''), auth.uid())
  on conflict (huella) do nothing returning true into v_nuevo;
  if v_nuevo then
    perform public._cc_notificar('error_app', null, null, array['admin'],
      format('Error nuevo en la app (%s): %s', coalesce(nullif(v_rol, ''), p_origen), left(v_msg, 160)), 'sistema_errores', 'error:' || v_huella);
  end if;
  return 'nuevo';
end;
$function$;
revoke all on function public.registrar_error(text,text,text,text) from public, anon;
grant execute on function public.registrar_error(text,text,text,text) to authenticated, service_role;

-- push para los avisos nuevos (errores a Dirección; efectivo y envíos al chofer)
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind = any (array['handoff_asignado','handoff_aviso','handoff_escalado','handoff_sin_vendedor','retoma','cliente_escribe',
                              'senal_compra','verificacion_wa','link_pago','error_app','envio_chofer','envio_regreso','efectivo_chofer']))
  execute function public._cc_aviso_push_tr();

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.aviso_push_carga(uuid)'::regprocedure);
  d := replace(d, '''link_pago'' then ''💳 Te piden link de pago'' else',
                  '''link_pago'' then ''💳 Te piden link de pago'' when ''error_app'' then ''⚠️ Error en la app''
                         when ''envio_chofer'' then ''🚚 Cambio de entrega'' when ''envio_regreso'' then ''📦 Pedido regresó al almacén''
                         when ''efectivo_chofer'' then ''💵 Efectivo recibido'' else');
  execute d;
end $patch$;

-- permisos
revoke all on function public.mi_efectivo_chofer() from public, anon;
revoke all on function public.efectivo_choferes() from public, anon;
revoke all on function public.recibir_efectivo_chofer(uuid,uuid,numeric,text) from public, anon;
revoke all on function public.envio_regreso_almacen(uuid,text) from public, anon;
revoke all on function public.envio_cambiar_chofer(uuid,uuid) from public, anon;
revoke all on function public.doctor_dar_de_baja(uuid,text) from public, anon;
grant execute on function public.mi_efectivo_chofer(), public.efectivo_choferes(), public.recibir_efectivo_chofer(uuid,uuid,numeric,text),
  public.envio_regreso_almacen(uuid,text), public.envio_cambiar_chofer(uuid,uuid), public.doctor_dar_de_baja(uuid,text) to authenticated;

-- ============================================================================ post-guards
do $post$ begin
  if position('BLOQUE1: leyenda en notas' in pg_get_functiondef('public.registrar_cobro_entrega(uuid,uuid,text,numeric,text)'::regprocedure)) = 0
     or position('BLOQUE1 · chofer' in pg_get_functiondef('public._w2_corte_desde(date,text,uuid)'::regprocedure)) = 0
     or position('CFDI_VIGENTE' in pg_get_functiondef('public.cancelar_pedido(uuid,uuid,text)'::regprocedure)) = 0
     or position('error_app' in pg_get_functiondef('public.aviso_push_carga(uuid)'::regprocedure)) = 0 then
    raise exception 'BLOQUE1: no quedó aplicada';
  end if;
end $post$;
