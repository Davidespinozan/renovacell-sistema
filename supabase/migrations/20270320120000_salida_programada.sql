-- ============================================================================
-- SALIDA PROGRAMADA (2 nov 2026, dueño: "que se pueda comprar un pedido pero que los vendedores lo agenden de salida
-- para una fecha en específico, porque muchas veces hacen pedidos 15 días por anticipado y los pagan").
--   · El PERSONAL (vendedor, Dirección, Almacén) elige la fecha de salida al levantar el pedido o después (con motivo).
--   · Se reutiliza la regla de siempre calculada "como si fuera" ese día: días de salida de la paquetería o del chofer,
--     horario de entrega local (desde la fecha programada), promesa al cliente y, con servicio DHL, la fecha exacta
--     corrida los mismos días. El flete NO cambia al reprogramar.
--   · Hasta 90 días. No antes de lo que la regla permite hoy. No en un día sin salida (se dice cuál es el siguiente).
-- ============================================================================
do $d$
declare v text;
begin
  v := pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure);
  if position('declare ops jsonb; o jsonb; v_id text;' in v) = 0
     or position('  ops := public.entrega_opciones(p_actor, p_subtotal, p_cp, p_ahora);
  select x into o from jsonb_array_elements(ops -> ''opciones'') x where x ->> ''id'' = v_id;' in v) = 0
     or position('p_eleccion -> ''horario'' ->> ''inicio'', p_ahora, true);' in v) = 0
     or position('    ''actor'', p_actor, ''calculado_at'', p_ahora)), p_eleccion, p_ahora);' in v) = 0 then
    raise exception 'SALIDA_PROGRAMADA: _entrega_normalizar cambió';
  end if;
  v := replace(v, 'declare ops jsonb; o jsonb; v_id text;', 'declare ops jsonb; o jsonb; v_id text; v_prog date; v_calc timestamptz := p_ahora; v_normal date;');
  v := replace(v, '  ops := public.entrega_opciones(p_actor, p_subtotal, p_cp, p_ahora);
  select x into o from jsonb_array_elements(ops -> ''opciones'') x where x ->> ''id'' = v_id;', '  ops := public.entrega_opciones(p_actor, p_subtotal, p_cp, p_ahora);
  select x into o from jsonb_array_elements(ops -> ''opciones'') x where x ->> ''id'' = v_id;
  -- SALIDA PROGRAMADA: el personal agenda la salida; la regla se calcula como si fuera ese día.
  if o is not null and nullif(btrim(coalesce(p_eleccion ->> ''salida_programada'', '''')), '''') is not null then
    if p_actor <> ''staff'' then raise exception ''SALIDA_SOLO_PERSONAL: la fecha de salida la agenda tu asesor'' using errcode = ''check_violation''; end if;
    if (p_eleccion ->> ''salida_programada'') !~ ''^\d{4}-\d{2}-\d{2}$'' then raise exception ''SALIDA_INVALIDA: fecha de salida inválida'' using errcode = ''check_violation''; end if;
    if o ->> ''tipo'' = ''mostrador'' then raise exception ''SALIDA_NO_APLICA: en mostrador se entrega en el momento'' using errcode = ''check_violation''; end if;
    v_prog := (p_eleccion ->> ''salida_programada'')::date; v_normal := (o ->> ''salida'')::date;
    if v_prog < v_normal then raise exception ''SALIDA_ANTES_DE_TIEMPO: lo más pronto que puede salir es el %'', to_char(v_normal, ''DD/MM/YYYY'') using errcode = ''check_violation''; end if;
    if v_prog > (p_ahora at time zone public._entrega_zona())::date + 90 then raise exception ''SALIDA_LEJANA: la salida se agenda hasta 90 días adelante'' using errcode = ''check_violation''; end if;
    if v_prog = v_normal then v_prog := null;   -- es la salida de siempre: no es programada
    else
      v_calc := (v_prog::timestamp + time ''08:00'') at time zone public._entrega_zona();
      ops := public.entrega_opciones(p_actor, p_subtotal, p_cp, v_calc);
      select x into o from jsonb_array_elements(ops -> ''opciones'') x where x ->> ''id'' = v_id;
      if o is not null and (o ->> ''salida'')::date <> v_prog then
        raise exception ''SALIDA_DIA_NO_VALIDO: ese día no hay salida; la siguiente es el %'', to_char((o ->> ''salida'')::date, ''DD/MM/YYYY'') using errcode = ''check_violation'';
      end if;
    end if;
  end if;');
  v := replace(v, 'p_eleccion -> ''horario'' ->> ''inicio'', p_ahora, true);', 'p_eleccion -> ''horario'' ->> ''inicio'', v_calc, true);   -- con salida programada, el horario es desde esa fecha');
  v := replace(v, '    ''actor'', p_actor, ''calculado_at'', p_ahora)), p_eleccion, p_ahora);', '    ''actor'', p_actor, ''programada'', case when v_prog is not null then true end, ''calculado_at'', p_ahora)),
    p_eleccion || case when v_prog is not null then jsonb_build_object(''_salida_normal'', v_normal) else ''{}''::jsonb end, p_ahora);');
  execute v;

  -- Servicio DHL con salida programada: la fecha exacta cotizada (para salir hoy) se corre los mismos días.
  v := pg_get_functiondef('public._entrega_servicio(jsonb,jsonb,timestamptz)'::regprocedure);
  if position('declare q public.entrega_cotizaciones; s jsonb; v_min numeric; v_dif numeric; v_flete numeric;' in v) = 0
     or position('  -- Un ajuste del personal con motivo manda sobre la regla;' in v) = 0 then raise exception 'SALIDA_PROGRAMADA: _entrega_servicio cambió'; end if;
  v := replace(v, 'declare q public.entrega_cotizaciones; s jsonb; v_min numeric; v_dif numeric; v_flete numeric;', 'declare q public.entrega_cotizaciones; s jsonb; v_min numeric; v_dif numeric; v_flete numeric; v_corr int;');
  execute replace(v, '  -- Un ajuste del personal con motivo manda sobre la regla;', '  v_corr := coalesce((p_norm ->> ''salida'')::date - nullif(p_eleccion ->> ''_salida_normal'', '''')::date, 0);
  if v_corr <> 0 then
    s := s || jsonb_build_object(''llega_fecha'', ((s ->> ''llega_fecha'')::date + v_corr)::text)
           || case when s ? ''llega_at'' then jsonb_build_object(''llega_at'', to_char((s ->> ''llega_at'')::timestamp + make_interval(days => v_corr), ''YYYY-MM-DD"T"HH24:MI:SS'')) else ''{}''::jsonb end;
  end if;
  -- Un ajuste del personal con motivo manda sobre la regla;');
end $d$;

-- La lista de pedidos del cliente en el chat del vendedor trae la entrega (para agendar la salida desde ahí).
do $d$
declare v text;
begin
  v := pg_get_functiondef('public.cc_cliente_pedidos(uuid)'::regprocedure);
  if position('''total'', o.total, ''estado'', o.status,' in v) = 0 then raise exception 'SALIDA_PROGRAMADA: cc_cliente_pedidos cambió'; end if;
  execute replace(v, '''total'', o.total, ''estado'', o.status,', '''total'', o.total, ''estado'', o.status, ''entrega'', o.shipping_meta -> ''entrega'',');
end $d$;

-- Programar o mover la salida de un pedido ya hecho (antes de empacarlo). El flete no cambia.
create or replace function public.entrega_salida_programar(p_order uuid, p_salida date, p_horario jsonb default null, p_motivo text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_rol text := public.auth_role(); o record; e jsonb; v_new jsonb; v_motivo text; v_trusted text := coalesce(current_setting('app.trusted', true), '');
        v_corr int; v_f date; v_i time; v_fin time; v_cupo smallint;
begin
  if v_rol not in ('admin', 'warehouse', 'pos') then raise exception 'NO_AUTORIZADO: solo el personal agenda la salida' using errcode = 'insufficient_privilege'; end if;
  v_motivo := nullif(btrim(left(coalesce(p_motivo, ''), 200)), '');
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'MOTIVO_REQUERIDO: escribe por qué se agenda o cambia la salida' using errcode = 'check_violation'; end if;
  select id, status, external_ref, customer_id, shipping_meta into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if v_rol = 'pos' and not coalesce(public._sec_c1_pos_ve_pedido(p_order) or (o.customer_id is not null and public._cc_vendedor_de_cliente(o.customer_id) = auth.uid()), false) then   -- coalesce: sin vendedor asignado NO es "sí"
    raise exception 'NO_AUTORIZADO: ese pedido es de otro vendedor' using errcode = 'insufficient_privilege';
  end if;
  if o.status not in ('draft', 'pending_payment', 'paid', 'picking') then raise exception 'PEDIDO_EN_CAMINO: el pedido ya está % y su salida no se cambia', o.status using errcode = 'check_violation'; end if;
  e := o.shipping_meta -> 'entrega';
  if e is null then raise exception 'SIN_ENTREGA: el pedido no tiene entrega registrada' using errcode = 'check_violation'; end if;

  -- el horario del chofer reservado se libera antes de validar el nuevo
  update public.entrega_horarios set estado = 'liberado', liberado_at = now(), motivo_liberacion = 'Salida reprogramada: ' || v_motivo where order_id = p_order and estado = 'reservado';
  v_new := public._entrega_normalizar('staff', coalesce((e ->> 'subtotal')::numeric, 0), e ->> 'cp',
             jsonb_build_object('opcion', e ->> 'opcion', 'salida_programada', p_salida::text, 'horario', p_horario, 'motivo', coalesce(e ->> 'ajuste_motivo', v_motivo)), now());
  -- el precio NO cambia: se conserva el flete del pedido; el servicio de paquetería se conserva y su fecha se corre
  v_new := v_new || jsonb_strip_nulls(jsonb_build_object('flete', e -> 'flete', 'flete_regla', e -> 'flete_regla', 'ajuste_motivo', e -> 'ajuste_motivo', 'bajo_minimo', e -> 'bajo_minimo'));
  if e ? 'servicio' then
    v_corr := (v_new ->> 'salida')::date - (e ->> 'salida')::date;
    v_new := v_new || jsonb_build_object('servicio', (e -> 'servicio') || jsonb_build_object('llega_fecha', ((e -> 'servicio' ->> 'llega_fecha')::date + v_corr)::text)
                         || case when e -> 'servicio' ? 'llega_at' then jsonb_build_object('llega_at', to_char((e -> 'servicio' ->> 'llega_at')::timestamp + make_interval(days => v_corr), 'YYYY-MM-DD"T"HH24:MI:SS')) else '{}'::jsonb end,
                       'llega_desde', ((e -> 'servicio' ->> 'llega_fecha')::date + v_corr)::text, 'llega_hasta', ((e -> 'servicio' ->> 'llega_fecha')::date + v_corr)::text);
  end if;
  if v_new ? 'horario' then
    v_f := (v_new -> 'horario' ->> 'fecha')::date; v_i := (v_new -> 'horario' ->> 'inicio')::time; v_fin := (v_new -> 'horario' ->> 'fin')::time;
    perform pg_advisory_xact_lock(hashtext('entrega_horario'), hashtext(v_f::text || ' ' || v_i::text));
    select horario_cupo into v_cupo from public.entrega_config where id = 1;
    if public._entrega_horario_ocupados(v_f, v_i) >= v_cupo then raise exception 'HORARIO_OCUPADO: ese horario de entrega ya está ocupado; elige otro' using errcode = 'check_violation'; end if;
    insert into public.entrega_horarios (order_id, fecha, inicio, fin, created_by) values (p_order, v_f, v_i, v_fin, auth.uid());
  end if;
  v_new := v_new || jsonb_build_object('reprogramado', jsonb_build_object('salida_anterior', e -> 'salida', 'motivo', v_motivo, 'por', auth.uid(), 'at', now()));
  perform set_config('app.trusted', 'on', true);
  update public.orders set shipping_meta = jsonb_set(shipping_meta, '{entrega}', v_new) where id = p_order;
  perform set_config('app.trusted', v_trusted, true);
  perform public.log_audit('Salida del pedido agendada', 'orders', coalesce(o.external_ref, p_order::text) || ': ' || coalesce(e ->> 'salida', '?') || ' → ' || (v_new ->> 'salida') || ' · ' || v_motivo,
                           case v_rol when 'admin' then 'Dirección' when 'warehouse' then 'Almacén' else 'Ventas' end);
  return jsonb_build_object('order_id', p_order, 'folio', o.external_ref, 'entrega', v_new);
end;
$$;
revoke all on function public.entrega_salida_programar(uuid, date, jsonb, text) from public, anon;
grant execute on function public.entrega_salida_programar(uuid, date, jsonb, text) to authenticated;
