-- Reversa de 20270314120000_entrega_servicio.sql.
do $d$
declare v text;
begin
  v := pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb,jsonb)'::regprocedure);
  if position(', ''servicio'', p_entrega -> ''servicio'')' in v) > 0 then execute replace(v, ', ''servicio'', p_entrega -> ''servicio'')', ')'); end if;
  v := pg_get_functiondef('public.cc_checkout_confirmar'::regproc);
  if position(', ''servicio'', r.entrega -> ''servicio'')' in v) > 0 then execute replace(v, ', ''servicio'', r.entrega -> ''servicio'')', ')'); end if;
end $d$;
do $d$
declare v text := pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure);
begin
  if position('  return public._entrega_servicio(jsonb_strip_nulls(jsonb_build_object(
    ''opcion'', o ->> ''id''' in v) > 0 then execute replace(replace(v, '  return public._entrega_servicio(jsonb_strip_nulls(jsonb_build_object(
    ''opcion'', o ->> ''id''', '  return jsonb_strip_nulls(jsonb_build_object(
    ''opcion'', o ->> ''id'''), '    ''actor'', p_actor, ''calculado_at'', p_ahora)), p_eleccion, p_ahora);
end;', '    ''actor'', p_actor, ''calculado_at'', p_ahora));
end;'); end if;
end $d$;
drop function if exists public._entrega_servicio(jsonb, jsonb, timestamptz);
alter table public.entrega_config drop column if exists paquete_kg_base, drop column if exists paquete_kg_pieza, drop column if exists paquete_largo_cm, drop column if exists paquete_ancho_cm, drop column if exists paquete_alto_cm;
drop table if exists public.entrega_cotizaciones;
