-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PARIDAD DE REGLAS DE VENTA (ENT-P) · "todas las maneras de comprar o vender no pueden ser flujos diferentes"
--   Pedido del dueño (28 oct 2026). Auditoría de los 6 caminos de venta (Catálogo del doctor, carrito del chat, Caja
--   mostrador/evento, Caja con entrega, Levantar pedido, WhatsApp): precio, opciones, flete, promesa y horario ya salen de
--   la misma regla del servidor. La brecha de regla: el doctor no puede pedir chofer local abajo del mínimo ($500) y el
--   personal sí, gratis y sin decir por qué. Decisión: el personal la puede dar como CORTESÍA, con motivo obligatorio
--   (como cualquier ajuste de flete); el pedido la marca (shipping_meta.entrega.bajo_minimo + ajuste_motivo).
--   · _entrega_normalizar (189, redefinida)  idéntica salvo el bloque ENT-P.
--   NO cambia: entrega_opciones, _entrega_aplicar, crear_pedido*, cc_checkout_*, vender_pos, el portal del doctor.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure)) <> '7d731bdba48f2dc348350b8469f1e0f8' then
    raise exception 'ENT-P: _entrega_normalizar no es la versión de la 189 (¿ya aplicada?)';
  end if;
end $pre$;

create or replace function public._entrega_normalizar(p_actor text, p_subtotal numeric, p_cp text, p_eleccion jsonb, p_ahora timestamptz default now()) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare ops jsonb; o jsonb; v_id text; v_costo numeric; v_motivo text; cfg public.entrega_config%rowtype; v_hor jsonb; v_bajo boolean := false;
begin
  if p_eleccion is null or jsonb_typeof(p_eleccion) <> 'object' then raise exception 'ENTREGA_REQUERIDA: el pedido necesita cómo se entrega' using errcode = 'check_violation'; end if;
  v_id := nullif(btrim(coalesce(p_eleccion ->> 'opcion', '')), '');
  ops := public.entrega_opciones(p_actor, p_subtotal, p_cp, p_ahora);
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = v_id;
  if o is null then raise exception 'ENTREGA_INVALIDA: opción de entrega desconocida' using errcode = 'check_violation'; end if;
  if not (o ->> 'permitido')::boolean then raise exception 'ENTREGA_NO_PERMITIDA: %', coalesce(o ->> 'motivo', 'esa entrega no aplica') using errcode = 'check_violation'; end if;
  if not (o ->> 'disponible')::boolean then raise exception 'ENTREGA_NO_DISPONIBLE: esa paquetería aún no está activa' using errcode = 'check_violation'; end if;
  v_costo := (o ->> 'flete')::numeric;
  if p_actor = 'staff' and p_eleccion ? 'flete' and jsonb_typeof(p_eleccion -> 'flete') = 'number' then
    if (p_eleccion ->> 'flete')::numeric < 0 or (p_eleccion ->> 'flete')::numeric > 99999 then raise exception 'ENTREGA_FLETE_INVALIDO' using errcode = 'check_violation'; end if;
    if (p_eleccion ->> 'flete')::numeric <> v_costo then
      v_motivo := nullif(btrim(left(coalesce(p_eleccion ->> 'motivo', ''), 200)), '');
      if v_motivo is null or length(v_motivo) < 3 then raise exception 'ENTREGA_AJUSTE_SIN_MOTIVO: para cambiar el flete escribe el motivo' using errcode = 'check_violation'; end if;
      v_costo := round((p_eleccion ->> 'flete')::numeric, 2);
    end if;
  end if;
  -- ENT-P · paridad con el portal: la entrega con chofer es gratis desde el mínimo (al doctor abajo del mínimo se le ofrece
  -- recoger). El personal puede darla abajo del mínimo solo como CORTESÍA con motivo (≥ 3 letras); queda en el pedido.
  select * into cfg from public.entrega_config where id = 1;
  if p_actor = 'staff' and o ->> 'tipo' = 'local' and coalesce(cfg.local_gratis_desde, 0) > 0 and coalesce((ops ->> 'subtotal')::numeric, 0) < cfg.local_gratis_desde then
    v_motivo := coalesce(v_motivo, nullif(btrim(left(coalesce(p_eleccion ->> 'motivo', ''), 200)), ''));
    if v_motivo is null or length(v_motivo) < 3 then
      raise exception 'ENTREGA_MINIMO_SIN_MOTIVO: abajo del mínimo la entrega con chofer es cortesía; escribe el motivo' using errcode = 'check_violation';
    end if;
    v_bajo := true;
  end if;
  -- ENT-H · entrega local por chofer: el horario elegido se valida aquí (existe, día válido, no pasado, con cupo).
  if o ->> 'tipo' = 'local' and o ->> 'paqueteria' = 'chofer' then
    v_hor := public._entrega_horario_validar(p_eleccion -> 'horario' ->> 'fecha', p_eleccion -> 'horario' ->> 'inicio', p_ahora, true);
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'opcion', o ->> 'id', 'tipo', o ->> 'tipo', 'paqueteria', o -> 'paqueteria', 'texto', o ->> 'texto',
    'flete', v_costo, 'flete_regla', (o ->> 'flete')::numeric, 'ajuste_motivo', v_motivo, 'bajo_minimo', case when v_bajo then true end,
    'local', ops -> 'local', 'cp', ops -> 'cp', 'subtotal', ops -> 'subtotal',
    'salida', o -> 'salida', 'antes_de_corte', o -> 'antes_de_corte',
    'llega_desde', coalesce(v_hor -> 'fecha', o -> 'llega_desde'), 'llega_hasta', coalesce(v_hor -> 'fecha', o -> 'llega_hasta'),
    'horario', v_hor,
    'recoge', case when o ->> 'tipo' = 'recoge' then jsonb_build_object('lugar', cfg.recoge_lugar, 'horario', cfg.recoge_horario) end,
    'actor', p_actor, 'calculado_at', p_ahora));
end;
$$;
alter function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz) owner to postgres;
revoke all on function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
comment on function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz) is 'ENT-0/ENT-H/ENT-P · valida la entrega elegida con la regla del servidor; el personal da chofer local abajo del mínimo solo con motivo.';

do $post$ begin
  if has_function_privilege('authenticated', 'public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)', 'execute') then raise exception 'ENT-P: permisos inesperados'; end if;
  if md5(pg_get_functiondef('public.entrega_opciones(text,numeric,text,timestamptz)'::regprocedure)) is null then raise exception 'ENT-P: falta entrega_opciones'; end if;
end $post$;
