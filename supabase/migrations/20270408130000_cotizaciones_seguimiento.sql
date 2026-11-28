-- ============================================================================
-- COTIZACIONES CON SEGUIMIENTO (28 nov 2026, dueño: «quieren poder cotizar y dar seguimiento a la cotización … a veces se
-- hace una cotización que nunca se cierra, entonces no vale la pena meterla como si fuera una venta; las ventas solo
-- deben ser cuando ya son seguras. Una cotización expira, y que le den seguimiento desde Inicio»).
-- Las cotizaciones ya existían (20270209: crear, mandar, convertida, cancelar; vigencia 7 días) pero solo se hacían
-- desde el chat y no había dónde verlas. Esto agrega:
--   · `cotizaciones_abiertas()`: las cotizaciones sin cerrar (vigentes y las vencidas hace ≤ 15 días, para retomarlas).
--     Dirección y el jefe de ventas ven las de todo el equipo; cada vendedora, las suyas (de su cartera o que ella hizo).
--   · `cc_cotizacion_extender(cot, dias)`: le da más días a una cotización viva o recién vencida (1 a 30 días).
-- Solo crea funciones (sin tablas ni índices). Rollback:
--   drop function public.cotizaciones_abiertas(); drop function public.cc_cotizacion_extender(uuid, integer);
-- ============================================================================
do $pre$ begin
  if to_regprocedure('public.cotizaciones_abiertas()') is not null then raise exception 'COT-SEG: ya aplicada'; end if;
  if to_regprocedure('public._cot_exige(uuid)') is null or to_regprocedure('public._jefe_ventas()') is null then raise exception 'COT-SEG: faltan piezas previas'; end if;
end $pre$;

create function public.cotizaciones_abiertas()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by x ->> 'vigente_hasta'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', c.id, 'folio', c.folio, 'customer_id', c.customer_id, 'conversation_id', c.conversation_id,
      'cliente', cu.full_name, 'telefono', cu.phone, 'correo', cu.email,
      'total', c.total, 'lineas', c.lineas, 'notas', c.notas, 'vigente_hasta', c.vigente_hasta, 'created_at', c.created_at,
      'enviada_chat_at', c.enviada_chat_at, 'enviada_correo_at', c.enviada_correo_at,
      'vendedor', (select coalesce(nullif(p.meta ->> 'name', ''), p.full_name) from public.profiles p where p.id = coalesce(c.seller_profile_id, c.created_by)),
      'mia', coalesce(c.seller_profile_id, c.created_by) = auth.uid() or c.created_by = auth.uid()) x
      from public.cotizaciones c join public.customers cu on cu.id = c.customer_id
     where auth.uid() is not null and c.estado = 'enviada' and c.vigente_hasta > now() - interval '15 days'
       and (public.auth_role() = 'admin' or public._jefe_ventas()
            or (public.auth_role() = 'pos' and (c.seller_profile_id = auth.uid() or c.created_by = auth.uid())))
     limit 200
  ) t;
$function$;

create function public.cc_cotizacion_extender(p_cot uuid, p_dias integer)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r public.cotizaciones; v_nueva timestamptz;
begin
  if p_dias is null or p_dias < 1 or p_dias > 30 then raise exception 'DIAS_INVALIDOS: de 1 a 30 días' using errcode = 'check_violation'; end if;
  select * into r from public.cotizaciones where id = p_cot for update;
  if not found then raise exception 'COTIZACION_INEXISTENTE' using errcode = 'check_violation'; end if;
  perform public._cot_exige(r.customer_id);
  if r.estado <> 'enviada' then raise exception 'COTIZACION_NO_VIGENTE' using errcode = 'check_violation'; end if;
  v_nueva := greatest(now(), r.vigente_hasta) + make_interval(days => p_dias);
  update public.cotizaciones set vigente_hasta = v_nueva, updated_at = now() where id = p_cot;
  perform public.log_audit('Cotización extendida', r.folio, jsonb_build_object('antes', r.vigente_hasta, 'despues', v_nueva, 'dias', p_dias)::text, null);
  return jsonb_build_object('vigente_hasta', v_nueva);
end;
$function$;

revoke all on function public.cotizaciones_abiertas(), public.cc_cotizacion_extender(uuid, integer) from public, anon;
grant execute on function public.cotizaciones_abiertas(), public.cc_cotizacion_extender(uuid, integer) to authenticated, service_role;
comment on function public.cotizaciones_abiertas() is 'Cotizaciones sin cerrar (vigentes y vencidas ≤ 15 días) para dar seguimiento desde Inicio. Dirección/jefe de ventas: todas; vendedora: las suyas.';
