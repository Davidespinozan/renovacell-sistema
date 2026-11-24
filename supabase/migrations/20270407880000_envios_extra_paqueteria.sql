-- ============================================================================
-- ENVÍOS EXTRA · PAQUETERÍA POR ENVÍO (24 nov 2026, Ventas: «unos van por DHL y otros por Estafeta»).
--   · Cada envío extra lleva SU paquetería, elegida al vender: dhl, estafeta, etn, tus (Unidos de Sinaloa) o
--     tns (Norte de Sinaloa). Las que no son DHL se pueden apagar en Configuración (estafeta_activo, etn_activo…).
--   · Queda en shipping_meta.entrega.extras[i].paqueteria; Almacén la ve preseleccionada al generar la guía del extra.
--   · Sin paquetería (pantallas viejas aún abiertas): se acepta como antes y Almacén la elige.
--   · El costo del extra no cambia (entrega_config.envio_extra_costo).
-- Rollback: supabase/rollback/envios_extra_paqueteria/99_down.sql
-- ============================================================================
do $$
declare d text := pg_get_functiondef('public._entrega_extras(text,jsonb,jsonb)'::regprocedure);
  a1 text := 'k int := 0; v_costo numeric;';
  b1 text := 'k int := 0; v_costo numeric; v_paq text; cfg public.entrega_config;';
  a2 text := '    snap := public._cc_chk_direccion_snapshot(x -> ''address'');';
  b2 text := '    -- PAQUETERÍA POR ENVÍO · la que eligió la vendedora para ESTE envío (debe existir y estar activa).
    v_paq := nullif(lower(btrim(coalesce(x ->> ''paqueteria'', ''''))), '''');
    if v_paq is not null then
      if v_paq not in (''dhl'', ''estafeta'', ''etn'', ''tus'', ''tns'') then
        raise exception ''ENVIO_EXTRA_PAQUETERIA: el envío extra % trae una paquetería que no existe'', k using errcode = ''check_violation''; end if;
      if cfg.id is null then select * into cfg from public.entrega_config where id = 1; end if;
      if (v_paq = ''estafeta'' and not cfg.estafeta_activo) or (v_paq = ''etn'' and not cfg.etn_activo)
         or (v_paq = ''tus'' and not cfg.tus_activo) or (v_paq = ''tns'' and not cfg.tns_activo) then
        raise exception ''ENVIO_EXTRA_PAQUETERIA: la paquetería del envío extra % está apagada en Configuración'', k using errcode = ''check_violation''; end if;
    end if;
    snap := public._cc_chk_direccion_snapshot(x -> ''address'');';
  a3 text := '''lineas'', v_lineas, ''flete'', v_costo);';
  b3 text := '''lineas'', v_lineas, ''flete'', v_costo, ''paqueteria'', v_paq);';
begin
  if position('ENVIO_EXTRA_PAQUETERIA' in d) > 0 then raise exception 'ENVIOS_EXTRA_PAQ: ya aplicada'; end if;
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then raise exception 'ENVIOS_EXTRA_PAQ: _entrega_extras cambió'; end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;
revoke all on function public._entrega_extras(text, jsonb, jsonb) from public, anon, authenticated;

do $post$
begin
  if position('ENVIO_EXTRA_PAQUETERIA' in pg_get_functiondef('public._entrega_extras(text,jsonb,jsonb)'::regprocedure)) = 0 then
    raise exception 'ENVIOS_EXTRA_PAQ: _entrega_extras no quedó'; end if;
end $post$;
