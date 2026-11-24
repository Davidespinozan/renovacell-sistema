-- ============================================================================
-- PAQ-AUTOBÚS (24 nov 2026, dueño): paqueterías de autobús ETN, Unidos de Sinaloa y Norte de Sinaloa.
--   · Sin API: el cliente (portal) y el vendedor solo las ELIGEN al vender; Almacén captura la guía a mano (como Estafeta).
--   · Mismas reglas que cualquier envío foráneo: gratis desde el mínimo; si no, el costo foráneo; misma salida/corte.
--   · Fecha por regla: autobus_transito_min/max días (1–2 por omisión); cada una se apaga en Configuración.
-- ============================================================================
alter table public.entrega_config
  add column if not exists etn_activo boolean not null default true,
  add column if not exists tus_activo boolean not null default true,
  add column if not exists tns_activo boolean not null default true,
  add column if not exists autobus_transito_min smallint not null default 1 check (autobus_transito_min between 0 and 30),
  add column if not exists autobus_transito_max smallint not null default 2 check (autobus_transito_max between 0 and 30);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_entcfg_autobus' and conrelid = 'public.entrega_config'::regclass) then
    alter table public.entrega_config add constraint ck_entcfg_autobus check (autobus_transito_min <= autobus_transito_max);
  end if;
end $$;

-- ── entrega_opciones: las tres opciones de autobús, justo después de Estafeta (misma regla de zona y de precio).
do $$
declare d text := pg_get_functiondef('public.entrega_opciones(text,numeric,text,timestamptz)'::regprocedure);
  a text := '  -- envío foráneo por T1 (apagado hasta integrarlo)';
  b text;
  bus text := '';
  x record;
begin
  if position('foraneo_etn' in d) > 0 then raise exception 'PAQ-AUTOBUS: entrega_opciones ya trae autobús'; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'PAQ-AUTOBUS: entrega_opciones cambió'; end if;
  for x in select * from (values ('etn', 'ETN', 'etn_activo'), ('tus', 'Unidos de Sinaloa', 'tus_activo'), ('tns', 'Norte de Sinaloa', 'tns_activo')) v(id, nombre, col) loop
    bus := bus || format(
'  ops := ops || public._entrega_opcion(%L, ''foraneo'', %L, c_for,
                       case when not v_doc then true when not v_dir then false else not v_local end,
                       case when v_doc and not v_dir then ''REQUIERE_DIRECCION'' when v_doc and v_local then ''ZONA_LOCAL'' end,
                       cfg.%s, s_paq, public._entrega_sumar_dias((s_paq ->> ''salida'')::date, cfg.autobus_transito_min, cfg.dias_entrega_foranea),
                       public._entrega_sumar_dias((s_paq ->> ''salida'')::date, cfg.autobus_transito_max, cfg.dias_entrega_foranea), %L);
', 'foraneo_' || x.id, x.id, x.col, 'Paquetería de autobús ' || x.nombre);
  end loop;
  b := '  -- PAQ-AUTOBÚS (24 nov 2026) · ETN, Unidos de Sinaloa y Norte de Sinaloa: sin API, guía manual en Almacén; regla foránea.
' || bus || a;
  execute replace(d, a, b);
end $$;

-- ── entrega_config_guardar: Dirección las prende/apaga y ajusta los días de tránsito.
do $$
declare d text := pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure);
  a text := '    t1_activo            = coalesce((p ->> ''t1_activo'')::boolean, cfg.t1_activo),';
  b text := '    -- PAQ-AUTOBÚS · ETN / Unidos de Sinaloa / Norte de Sinaloa
    etn_activo            = coalesce((p ->> ''etn_activo'')::boolean, cfg.etn_activo),
    tus_activo            = coalesce((p ->> ''tus_activo'')::boolean, cfg.tus_activo),
    tns_activo            = coalesce((p ->> ''tns_activo'')::boolean, cfg.tns_activo),
    autobus_transito_min  = coalesce((p ->> ''autobus_transito_min'')::smallint, cfg.autobus_transito_min),
    autobus_transito_max  = coalesce((p ->> ''autobus_transito_max'')::smallint, cfg.autobus_transito_max),
' || a;
begin
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'PAQ-AUTOBUS: entrega_config_guardar cambió'; end if;
  execute replace(d, a, b);
end $$;
