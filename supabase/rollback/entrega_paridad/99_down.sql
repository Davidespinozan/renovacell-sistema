-- ENT-P (paridad de reglas de venta) · rollback: _entrega_normalizar vuelve a la versión de la 189 (sin la cortesía con
-- motivo abajo del mínimo). No hay tablas ni datos que borrar: los pedidos ya creados conservan su ajuste_motivo.
create or replace function public._entrega_normalizar(p_actor text, p_subtotal numeric, p_cp text, p_eleccion jsonb, p_ahora timestamptz default now()) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare ops jsonb; o jsonb; v_id text; v_costo numeric; v_motivo text; cfg public.entrega_config%rowtype; v_hor jsonb;
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
  -- ENT-H · entrega local por chofer: el horario elegido se valida aquí (existe, día válido, no pasado, con cupo).
  if o ->> 'tipo' = 'local' and o ->> 'paqueteria' = 'chofer' then
    v_hor := public._entrega_horario_validar(p_eleccion -> 'horario' ->> 'fecha', p_eleccion -> 'horario' ->> 'inicio', p_ahora, true);
  end if;
  select * into cfg from public.entrega_config where id = 1;
  return jsonb_strip_nulls(jsonb_build_object(
    'opcion', o ->> 'id', 'tipo', o ->> 'tipo', 'paqueteria', o -> 'paqueteria', 'texto', o ->> 'texto',
    'flete', v_costo, 'flete_regla', (o ->> 'flete')::numeric, 'ajuste_motivo', v_motivo,
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
