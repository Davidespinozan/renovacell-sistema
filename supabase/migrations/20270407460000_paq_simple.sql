-- ============================================================================
-- PAQ-SIMPLE (23 nov 2026) · decisión del dueño que reemplaza «el servicio se elige al vender» (2 nov):
--   · Al vender (vendedor o doctor) en un envío foráneo se elige SOLO la paquetería: DHL o Estafeta.
--   · El cliente paga SOLO la regla de siempre (gratis desde foraneo_gratis_desde; si no, foraneo_costo). Se acabó el
--     recargo «diferencia contra el más barato».
--   · DHL promete la fecha MÁS TARDÍA entre los servicios permitidos de la cotización en vivo (Almacén elige el servicio
--     después, así que la promesa es la conservadora). La lista de servicios prohibidos (ECONOMY SELECT 'G') vive en
--     supabase/functions/_shared/cotizarEnvio.ts: la Edge entrega-cotizar ya guarda la cotización sin ellos.
--     Si la cotización no sirve (no existe, venció, otra dirección) se queda el rango de la regla: nunca se detiene una venta.
--   · Estafeta (aún sin API): fecha por regla (estafeta_transito_min/max) y se apaga con estafeta_activo.
--   · shipping_meta.entrega.servicio queda solo como la PROMESA de fecha ({proveedor, llega_fecha, cotizacion_id}); no ata a
--     Almacén, que elige el servicio real al generar la guía.
-- ============================================================================

alter table public.entrega_config
  add column if not exists estafeta_activo boolean not null default true,
  add column if not exists estafeta_transito_min smallint not null default 2 check (estafeta_transito_min between 0 and 30),
  add column if not exists estafeta_transito_max smallint not null default 4 check (estafeta_transito_max between 0 and 30);
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_entcfg_estafeta' and conrelid = 'public.entrega_config'::regclass) then
    alter table public.entrega_config add constraint ck_entcfg_estafeta check (estafeta_transito_min <= estafeta_transito_max);
  end if;
end $c$;

-- ── 1) _entrega_servicio: la cotización solo da la FECHA (la más tardía de los servicios permitidos); el flete no cambia ──
do $patch$
declare v text := pg_get_functiondef('public._entrega_servicio(jsonb,jsonb,timestamptz)'::regprocedure);
begin
  if position('v_dif := ceil(greatest(0, (s ->> ''costo'')::numeric - coalesce(v_min, 0)));' in v) = 0
     or position('(p_norm ->> ''flete'')::numeric + v_dif' in v) = 0
     or position('v_corr := coalesce((p_norm ->> ''salida'')::date - nullif(p_eleccion ->> ''_salida_normal'', '''')::date, 0);' in v) = 0 then
    raise exception 'PAQ-SIMPLE: _entrega_servicio cambió; revisar antes de aplicar';
  end if;
end $patch$;

create or replace function public._entrega_servicio(p_norm jsonb, p_eleccion jsonb, p_ahora timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare q public.entrega_cotizaciones; v_id text; v_fecha date; v_corr int;
begin
  -- PAQ-SIMPLE (23 nov 2026) · solo DHL trae cotización en vivo; Estafeta (y lo demás) se queda con la regla.
  if p_norm ->> 'tipo' <> 'foraneo' or coalesce(p_norm ->> 'paqueteria', '') <> 'dhl' or p_eleccion is null or not (p_eleccion ? 'servicio')
     or jsonb_typeof(p_eleccion -> 'servicio') <> 'object' then return p_norm; end if;
  v_id := p_eleccion -> 'servicio' ->> 'cotizacion_id';
  if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return p_norm; end if;
  select * into q from public.entrega_cotizaciones where id = v_id::uuid;
  -- La cotización solo sirve para la promesa: si no existe, venció o es de otra dirección, queda el rango de la regla.
  if not found or q.expira_at < p_ahora or q.proveedor <> 'dhl' or q.cp is distinct from (p_norm ->> 'cp') then return p_norm; end if;
  -- Promesa conservadora: la llegada MÁS TARDÍA de los servicios cotizados (la Edge ya quitó los prohibidos).
  select max(left(x ->> 'llega_fecha', 10)::date) into v_fecha from jsonb_array_elements(q.servicios) x
   where coalesce(x ->> 'llega_fecha', '') ~ '^\d{4}-\d{2}-\d{2}';
  if v_fecha is null then return p_norm; end if;
  -- SALIDA PROGRAMADA · la cotización es para salir hoy: la fecha se corre lo mismo que la salida.
  v_corr := coalesce((p_norm ->> 'salida')::date - nullif(p_eleccion ->> '_salida_normal', '')::date, 0);
  v_fecha := v_fecha + v_corr;
  return p_norm || jsonb_build_object('llega_desde', v_fecha::text, 'llega_hasta', v_fecha::text,
    'servicio', jsonb_build_object('proveedor', 'dhl', 'llega_fecha', v_fecha::text, 'cotizacion_id', q.id, 'promesa', 'mas_tardia'));
end;
$$;
revoke all on function public._entrega_servicio(jsonb, jsonb, timestamptz) from public, anon, authenticated;

do $patch$
declare v text := pg_get_functiondef('public._entrega_servicio(jsonb,jsonb,timestamptz)'::regprocedure);
begin
  if position('v_dif' in v) > 0 or position('''promesa'', ''mas_tardia''' in v) = 0 then raise exception 'PAQ-SIMPLE: _entrega_servicio no quedó'; end if;
end $patch$;

-- ── 2) entrega_opciones: la opción «Envío por Estafeta» (misma regla de precio que DHL; fecha por regla) ──
do $patch$
declare v text := pg_get_functiondef('public.entrega_opciones(text,numeric,text,timestamptz)'::regprocedure);
  ancla constant text := '  -- envío foráneo por T1 (apagado hasta integrarlo)';
begin
  if position(ancla in v) = 0 or position('''Envío por DHL'');' in v) = 0 then raise exception 'PAQ-SIMPLE: entrega_opciones cambió'; end if;
  if position('foraneo_estafeta' in v) > 0 then raise exception 'PAQ-SIMPLE: entrega_opciones ya trae Estafeta'; end if;
  execute replace(v, ancla,
'  -- PAQ-SIMPLE (23 nov 2026) · envío foráneo por Estafeta: misma regla de precio que DHL; la fecha por regla (aún sin API).
  ops := ops || public._entrega_opcion(''foraneo_estafeta'', ''foraneo'', ''estafeta'', c_for,
                       case when not v_doc then true when not v_dir then false else not v_local end,
                       case when v_doc and not v_dir then ''REQUIERE_DIRECCION'' when v_doc and v_local then ''ZONA_LOCAL'' end,
                       cfg.estafeta_activo, s_paq, public._entrega_sumar_dias((s_paq ->> ''salida'')::date, cfg.estafeta_transito_min, cfg.dias_entrega_foranea),
                       public._entrega_sumar_dias((s_paq ->> ''salida'')::date, cfg.estafeta_transito_max, cfg.dias_entrega_foranea), ''Envío por Estafeta'');
' || ancla);
  v := pg_get_functiondef('public.entrega_opciones(text,numeric,text,timestamptz)'::regprocedure);
  if position('''foraneo_estafeta'', ''foraneo'', ''estafeta''' in v) = 0 then raise exception 'PAQ-SIMPLE: entrega_opciones no quedó'; end if;
end $patch$;

-- ── 3) entrega_config_guardar: Dirección edita Estafeta (activa y días de tránsito) en «Regla de entrega» ──
do $patch$
declare v text := pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure);
  ancla constant text := '    t1_activo            = coalesce((p ->> ''t1_activo'')::boolean, cfg.t1_activo),';
begin
  if position(ancla in v) = 0 then raise exception 'PAQ-SIMPLE: entrega_config_guardar cambió'; end if;
  if position('estafeta_activo' in v) > 0 then raise exception 'PAQ-SIMPLE: entrega_config_guardar ya trae Estafeta'; end if;
  execute replace(v, ancla,
'    -- PAQ-SIMPLE · Estafeta (fecha por regla hasta integrar su API)
    estafeta_activo       = coalesce((p ->> ''estafeta_activo'')::boolean, cfg.estafeta_activo),
    estafeta_transito_min = coalesce((p ->> ''estafeta_transito_min'')::smallint, cfg.estafeta_transito_min),
    estafeta_transito_max = coalesce((p ->> ''estafeta_transito_max'')::smallint, cfg.estafeta_transito_max),
' || ancla);
  v := pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure);
  if position('estafeta_transito_max = coalesce(' in v) = 0 then raise exception 'PAQ-SIMPLE: entrega_config_guardar no quedó'; end if;
end $patch$;
