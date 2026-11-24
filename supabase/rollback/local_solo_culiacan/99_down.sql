-- ROLLBACK ENT-LOCAL (20270407860000): el personal vuelve a poder elegir entrega local fuera de zona (solo aviso).
begin;
CREATE OR REPLACE FUNCTION public.entrega_opciones(p_actor text, p_subtotal numeric, p_cp text, p_ahora timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg public.entrega_config%rowtype; v_local boolean; v_cp text; v_doc boolean; v_sub numeric := greatest(coalesce(p_subtotal, 0), 0);
  s_paq jsonb; s_cho jsonb; ops jsonb := '[]'::jsonb; sug text;
  c_for numeric; c_loc numeric; v_dir boolean;
begin
  if p_actor not in ('doctor', 'staff') then raise exception 'ENTREGA_ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_doc := p_actor = 'doctor';
  select * into cfg from public.entrega_config where id = 1;
  v_cp := nullif(btrim(coalesce(p_cp, '')), '');
  v_dir := coalesce(v_cp ~ '^[0-9]{5}$', false);
  v_local := v_dir and coalesce(public._entrega_es_local(v_cp), false);
  s_paq := public._entrega_salida(p_ahora, cfg.dias_paqueteria);
  s_cho := public._entrega_salida(p_ahora, cfg.dias_chofer);
  c_for := case when v_sub >= cfg.foraneo_gratis_desde then 0 else cfg.foraneo_costo end;
  c_loc := case when v_sub >= cfg.local_gratis_desde then 0 else cfg.local_costo end;

  -- mostrador: el cliente se lleva el producto en el acto (solo personal)
  ops := ops || public._entrega_opcion('mostrador', 'mostrador', null, 0, not v_doc, case when v_doc then 'SOLO_PERSONAL' end, true,
                       jsonb_build_object('salida', (s_cho ->> 'hoy'), 'antes_de_corte', (s_cho ->> 'antes_de_corte')::boolean), (s_cho ->> 'hoy')::date, (s_cho ->> 'hoy')::date, 'Entrega en mostrador');
  -- recoger en sucursal: siempre se puede; está listo el día de salida del chofer
  ops := ops || public._entrega_opcion('recoge', 'recoge', null, 0, true, null, true, s_cho, (s_cho ->> 'salida')::date, (s_cho ->> 'salida')::date, 'Recoger en ' || cfg.recoge_lugar);
  -- entrega local por chofer
  ops := ops || public._entrega_opcion('local_chofer', 'local', 'chofer', c_loc,
                       case when not v_doc then true when not v_dir then false when not v_local then false else v_sub >= cfg.local_gratis_desde end,
                       case when v_doc and not v_dir then 'REQUIERE_DIRECCION' when v_doc and not v_local then 'ZONA_FORANEA' when v_doc and v_sub < cfg.local_gratis_desde then 'MINIMO_LOCAL' end,
                       true, s_cho, case when cfg.local_mismo_dia then (s_cho ->> 'salida')::date else public._entrega_sumar_dias((s_cho ->> 'salida')::date, 1, cfg.dias_chofer) end,
                       case when cfg.local_mismo_dia then (s_cho ->> 'salida')::date else public._entrega_sumar_dias((s_cho ->> 'salida')::date, 1, cfg.dias_chofer) end,
                       'Entrega local (chofer de Renovacell)');
  -- envío foráneo por DHL
  ops := ops || public._entrega_opcion('foraneo_dhl', 'foraneo', 'dhl', c_for,
                       case when not v_doc then true when not v_dir then false else not v_local end,
                       case when v_doc and not v_dir then 'REQUIERE_DIRECCION' when v_doc and v_local then 'ZONA_LOCAL' end,
                       true, s_paq, public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.dhl_transito_min, cfg.dias_entrega_foranea),
                       public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.dhl_transito_max, cfg.dias_entrega_foranea), 'Envío por DHL');
  -- PAQ-SIMPLE (23 nov 2026) · envío foráneo por Estafeta: misma regla de precio que DHL; la fecha por regla (aún sin API).
  ops := ops || public._entrega_opcion('foraneo_estafeta', 'foraneo', 'estafeta', c_for,
                       case when not v_doc then true when not v_dir then false else not v_local end,
                       case when v_doc and not v_dir then 'REQUIERE_DIRECCION' when v_doc and v_local then 'ZONA_LOCAL' end,
                       cfg.estafeta_activo, s_paq, public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.estafeta_transito_min, cfg.dias_entrega_foranea),
                       public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.estafeta_transito_max, cfg.dias_entrega_foranea), 'Envío por Estafeta');
  -- envío foráneo por T1 (apagado hasta integrarlo)
  ops := ops || public._entrega_opcion('foraneo_t1', 'foraneo', 't1', c_for,
                       case when not v_doc then true when not v_dir then false else not v_local end,
                       case when v_doc and not v_dir then 'REQUIERE_DIRECCION' when v_doc and v_local then 'ZONA_LOCAL' end,
                       cfg.t1_activo, s_paq, public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.t1_transito_min, cfg.dias_entrega_foranea),
                       public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.t1_transito_max, cfg.dias_entrega_foranea), 'Envío por T1');

  sug := case when not v_dir then null when v_local then (case when v_doc and v_sub < cfg.local_gratis_desde then 'recoge' else 'local_chofer' end) else 'foraneo_dhl' end;
  return jsonb_build_object('actor', p_actor, 'subtotal', v_sub, 'cp', v_cp, 'local', v_local,
                            'corte', jsonb_build_object('hora', s_cho ->> 'corte', 'zona', s_cho ->> 'zona', 'antes_de_corte', (s_cho ->> 'antes_de_corte')::boolean, 'hoy', s_cho ->> 'hoy'),
                            'regla', jsonb_build_object('foraneo_gratis_desde', cfg.foraneo_gratis_desde, 'foraneo_flete', cfg.foraneo_costo, 'local_gratis_desde', cfg.local_gratis_desde),
                            'recoge', jsonb_build_object('lugar', cfg.recoge_lugar, 'horario', cfg.recoge_horario),
                            'sugerida', sug, 'opciones', ops);
end;
$function$

;
delete from supabase_migrations.schema_migrations where version = '20270407860000';
commit;
