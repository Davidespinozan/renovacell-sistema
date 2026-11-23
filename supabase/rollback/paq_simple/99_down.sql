-- Reversa de 20270407460000_paq_simple.sql (PAQ-SIMPLE · 23 nov 2026).
do $d$
declare v text; i int; j int;
begin
  -- entrega_opciones sin la opción de Estafeta
  v := pg_get_functiondef('public.entrega_opciones(text,numeric,text,timestamptz)'::regprocedure);
  i := position('  -- PAQ-SIMPLE (23 nov 2026) · envío foráneo por Estafeta' in v);
  if i > 0 then
    j := position('  -- envío foráneo por T1 (apagado hasta integrarlo)' in v);
    execute substr(v, 1, i - 1) || substr(v, j);
  end if;
  -- entrega_config_guardar sin Estafeta
  v := pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure);
  i := position('    -- PAQ-SIMPLE · Estafeta (fecha por regla hasta integrar su API)' in v);
  if i > 0 then
    j := position('    t1_activo            = coalesce(' in v);
    execute substr(v, 1, i - 1) || substr(v, j);
  end if;
end $d$;
-- _entrega_servicio como quedó con SALIDA PROGRAMADA (regla + diferencia del servicio elegido)
CREATE OR REPLACE FUNCTION public._entrega_servicio(p_norm jsonb, p_eleccion jsonb, p_ahora timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.entrega_cotizaciones; s jsonb; v_min numeric; v_dif numeric; v_flete numeric; v_corr int;
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
  v_corr := coalesce((p_norm ->> 'salida')::date - nullif(p_eleccion ->> '_salida_normal', '')::date, 0);
  if v_corr <> 0 then
    s := s || jsonb_build_object('llega_fecha', ((s ->> 'llega_fecha')::date + v_corr)::text)
           || case when s ? 'llega_at' then jsonb_build_object('llega_at', to_char((s ->> 'llega_at')::timestamp + make_interval(days => v_corr), 'YYYY-MM-DD"T"HH24:MI:SS')) else '{}'::jsonb end;
  end if;
  -- Un ajuste del personal con motivo manda sobre la regla; si no, regla + diferencia por el servicio más rápido.
  v_flete := case when p_norm ? 'ajuste_motivo' then (p_norm ->> 'flete')::numeric else (p_norm ->> 'flete')::numeric + v_dif end;
  return p_norm || jsonb_build_object('flete', v_flete, 'llega_desde', s ->> 'llega_fecha', 'llega_hasta', s ->> 'llega_fecha',
    'servicio', jsonb_strip_nulls(jsonb_build_object('proveedor', q.proveedor, 'codigo', s ->> 'codigo', 'nombre', s ->> 'nombre', 'llega_at', s ->> 'llega_at',
      'llega_fecha', s ->> 'llega_fecha', 'costo_paqueteria', (s ->> 'costo')::numeric, 'diferencia', v_dif, 'cotizacion_id', q.id)));
end;
$function$

;
revoke all on function public._entrega_servicio(jsonb, jsonb, timestamptz) from public, anon, authenticated;
alter table public.entrega_config drop constraint if exists ck_entcfg_estafeta;
alter table public.entrega_config drop column if exists estafeta_activo, drop column if exists estafeta_transito_min, drop column if exists estafeta_transito_max;
