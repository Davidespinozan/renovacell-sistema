-- ============================================================================
-- PAQUETERÍA ELEGIDA AL VENDER (2 nov 2026). Alberto: "los vendedores son los que tienen que elegir la paquetería del
-- cliente y el cliente también... él solamente crea la guía, y al usuario tiene que salirle exactamente cuándo llega su
-- pedido... porque no a todos los clientes les gustan todas las paqueterías". Dueño: el cliente paga la regla de siempre
-- (gratis desde 5,000; 600 abajo) y, si elige un servicio más rápido, la diferencia.
--   · entrega_cotizaciones: lo que la paquetería respondió al cotizar EN LA VENTA (servicios, costo, fecha exacta de
--     entrega). La escribe la Edge entrega-cotizar (servidor); vence en 2 horas.
--   · _entrega_servicio: si la elección trae servicio, se valida contra esa cotización (vigente, mismo CP y paquetería) y
--     queda en el pedido con su FECHA EXACTA; flete = regla + diferencia con el servicio más barato (al peso, hacia arriba). Sin servicio (o si la
--     paquetería no respondió) se usa la regla de siempre: nunca se detiene una venta.
--   · Paquete estimado para cotizar antes de empacar: peso base + peso por pieza y medidas, en entrega_config.
-- ============================================================================
create table if not exists public.entrega_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null check (proveedor in ('dhl', 't1')),
  cp text not null check (cp ~ '^[0-9]{5}$'),
  piezas int not null check (piezas > 0),
  paquete jsonb not null,
  servicios jsonb not null check (jsonb_typeof(servicios) = 'array'),
  creado_por uuid,
  created_at timestamptz not null default now(),
  expira_at timestamptz not null default now() + interval '2 hours'
);
alter table public.entrega_cotizaciones enable row level security;
revoke all on public.entrega_cotizaciones from public, anon, authenticated;

alter table public.entrega_config add column if not exists paquete_kg_base numeric(6,2) not null default 1.0 check (paquete_kg_base > 0),
  add column if not exists paquete_kg_pieza numeric(6,2) not null default 0.3 check (paquete_kg_pieza >= 0),
  add column if not exists paquete_largo_cm int not null default 30 check (paquete_largo_cm > 0),
  add column if not exists paquete_ancho_cm int not null default 25 check (paquete_ancho_cm > 0),
  add column if not exists paquete_alto_cm int not null default 20 check (paquete_alto_cm > 0);

create or replace function public._entrega_servicio(p_norm jsonb, p_eleccion jsonb, p_ahora timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare q public.entrega_cotizaciones; s jsonb; v_min numeric; v_dif numeric; v_flete numeric;
begin
  if p_norm ->> 'tipo' <> 'foraneo' or p_eleccion is null or not (p_eleccion ? 'servicio') or jsonb_typeof(p_eleccion -> 'servicio') <> 'object' then return p_norm; end if;
  select * into q from public.entrega_cotizaciones where id = nullif(p_eleccion -> 'servicio' ->> 'cotizacion_id', '')::uuid;
  if not found then raise exception 'ENTREGA_COTIZACION_INVALIDA: vuelve a cotizar el envío' using errcode = 'check_violation'; end if;
  if q.expira_at < p_ahora then raise exception 'ENTREGA_COTIZACION_VENCIDA: la cotización del envío venció; vuelve a cotizar' using errcode = 'check_violation'; end if;
  if q.cp is distinct from (p_norm ->> 'cp') or q.proveedor is distinct from (p_norm ->> 'paqueteria') then
    raise exception 'ENTREGA_COTIZACION_INVALIDA: la cotización es de otra dirección o paquetería; vuelve a cotizar' using errcode = 'check_violation';
  end if;
  select x into s from jsonb_array_elements(q.servicios) x where x ->> 'codigo' = p_eleccion -> 'servicio' ->> 'codigo';
  if s is null then raise exception 'ENTREGA_SERVICIO_INVALIDO: ese servicio no está en la cotización' using errcode = 'check_violation'; end if;
  select min((x ->> 'costo')::numeric) into v_min from jsonb_array_elements(q.servicios) x;
  v_dif := ceil(greatest(0, (s ->> 'costo')::numeric - coalesce(v_min, 0)));   -- al peso entero, hacia arriba
  -- Un ajuste del personal con motivo manda sobre la regla; si no, regla + diferencia por el servicio más rápido.
  v_flete := case when p_norm ? 'ajuste_motivo' then (p_norm ->> 'flete')::numeric else (p_norm ->> 'flete')::numeric + v_dif end;
  return p_norm || jsonb_build_object('flete', v_flete, 'llega_desde', s ->> 'llega_fecha', 'llega_hasta', s ->> 'llega_fecha',
    'servicio', jsonb_strip_nulls(jsonb_build_object('proveedor', q.proveedor, 'codigo', s ->> 'codigo', 'nombre', s ->> 'nombre', 'llega_at', s ->> 'llega_at',
      'llega_fecha', s ->> 'llega_fecha', 'costo_paqueteria', (s ->> 'costo')::numeric, 'diferencia', v_dif, 'cotizacion_id', q.id)));
end;
$$;
revoke all on function public._entrega_servicio(jsonb, jsonb, timestamptz) from public, anon, authenticated;

do $d$
declare v text := pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure);
begin
  if position('  return jsonb_strip_nulls(jsonb_build_object(
    ''opcion'', o ->> ''id''' in v) = 0 or position('    ''actor'', p_actor, ''calculado_at'', p_ahora));
end;' in v) = 0 then raise exception 'ENTREGA_SERVICIO: _entrega_normalizar cambió; revisar antes de aplicar'; end if;
  execute replace(replace(v, '  return jsonb_strip_nulls(jsonb_build_object(
    ''opcion'', o ->> ''id''', '  return public._entrega_servicio(jsonb_strip_nulls(jsonb_build_object(
    ''opcion'', o ->> ''id'''), '    ''actor'', p_actor, ''calculado_at'', p_ahora));
end;', '    ''actor'', p_actor, ''calculado_at'', p_ahora)), p_eleccion, p_ahora);
end;');
end $d$;

-- El checkout del portal (revisar → confirmar) deja pasar el servicio elegido; confirmar usa el que quedó en la revisión.
do $d$
declare v text;
begin
  v := pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb,jsonb)'::regprocedure);
  if position('jsonb_build_object(''opcion'', v_elec, ''horario'', p_entrega -> ''horario'')' in v) = 0 then raise exception 'ENTREGA_SERVICIO: cc_checkout_revisar cambió'; end if;
  execute replace(v, 'jsonb_build_object(''opcion'', v_elec, ''horario'', p_entrega -> ''horario'')', 'jsonb_build_object(''opcion'', v_elec, ''horario'', p_entrega -> ''horario'', ''servicio'', p_entrega -> ''servicio'')');
  v := pg_get_functiondef('public.cc_checkout_confirmar'::regproc);
  if position('''horario'', r.entrega -> ''horario'')' in v) = 0 then raise exception 'ENTREGA_SERVICIO: cc_checkout_confirmar cambió'; end if;
  execute replace(v, '''horario'', r.entrega -> ''horario'')', '''horario'', r.entrega -> ''horario'', ''servicio'', r.entrega -> ''servicio'')');
end $d$;
