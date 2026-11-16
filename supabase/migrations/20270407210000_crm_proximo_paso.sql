-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- EMBUDO · PRÓXIMO PASO CON FECHA Y OPORTUNIDADES QUIETAS (15 nov 2026, dueño: «dale»). En prod había 20 oportunidades
-- abiertas, ninguna movida a mano y 11 sin moverse más de 5 días: nadie sabía qué seguía con cada una.
--   · crm_oportunidades.proximo_paso / proximo_at: qué sigue y qué día («mandar cotización de Golden», 18 nov).
--   · crm_paso(id, texto, fecha): el vendedor (o Dirección / jefe de ventas) lo anota; vacío lo quita.
--   · QUIETA = abierta y (su paso ya venció, o no tiene paso y lleva 5+ días en la etapa). _crm_json la marca.
--   · Aviso diario (L–S 9:00 Mazatlán) a cada vendedor con lo que le toca hoy y lo quieto.
--   El monto sigue llenándose solo con la cotización y el pedido (sin cambio); aquí solo se anota a mano si no hay.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_oportunidades' and column_name = 'proximo_paso') then
    raise exception 'CRM-PASO: ya aplicada'; end if;
  if position('''dias_en_etapa'', greatest(0, extract(day from now() - o.etapa_at)::int))' in pg_get_functiondef('public._crm_json(public.crm_oportunidades)'::regprocedure)) = 0 then
    raise exception 'CRM-PASO: _crm_json cambió; revisar el parche'; end if;
  if to_regprocedure('public.hoy_local()') is null or to_regprocedure('public._crm_puede(uuid)') is null then raise exception 'CRM-PASO: faltan hoy_local o el embudo'; end if;
end $pre$;

alter table public.crm_oportunidades
  add column proximo_paso text check (proximo_paso is null or length(btrim(proximo_paso)) between 3 and 140),
  add column proximo_at   date;
create index ix_crm_op_proximo on public.crm_oportunidades (seller_profile_id, proximo_at) where etapa not in ('ganado', 'perdido');

create function public._crm_quieta(o public.crm_oportunidades) returns boolean language sql stable set search_path = public as
$$ select o.etapa not in ('ganado', 'perdido') and ((o.proximo_at is not null and o.proximo_at < public.hoy_local())
          or (o.proximo_at is null and now() - o.etapa_at >= interval '5 days')) $$;

do $patch$
declare d text := pg_get_functiondef('public._crm_json(public.crm_oportunidades)'::regprocedure);
begin
  execute replace(d, '''dias_en_etapa'', greatest(0, extract(day from now() - o.etapa_at)::int))',
    '''dias_en_etapa'', greatest(0, extract(day from now() - o.etapa_at)::int), ''proximo_paso'', o.proximo_paso, ''proximo_at'', o.proximo_at,'
    || ' ''quieta'', public._crm_quieta(o), ''paso_hoy'', o.etapa not in (''ganado'', ''perdido'') and o.proximo_at = public.hoy_local(),'
    || ' ''folio_cotizacion'', (select q.folio from public.cotizaciones q where q.id = o.cotizacion_id))');
end $patch$;

create function public.crm_paso(p_id uuid, p_texto text, p_fecha date) returns jsonb language plpgsql security definer set search_path = public as
$$
declare o public.crm_oportunidades; v_txt text := nullif(regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g'), '');
begin
  if not public._crm_puede(p_id) then raise exception 'NO_AUTORIZADO: esa oportunidad no es tuya' using errcode = 'insufficient_privilege'; end if;
  if v_txt is null and p_fecha is null then
    update public.crm_oportunidades set proximo_paso = null, proximo_at = null, updated_at = now() where id = p_id returning * into o;
    return public._crm_json(o);
  end if;
  if v_txt is null or length(v_txt) < 3 then raise exception 'PASO_INVALIDO: escribe qué sigue (mínimo 3 letras)' using errcode = 'check_violation'; end if;
  if length(v_txt) > 140 then raise exception 'PASO_INVALIDO: máximo 140 caracteres' using errcode = 'check_violation'; end if;
  if p_fecha is null then raise exception 'PASO_INVALIDO: elige el día' using errcode = 'check_violation'; end if;
  if p_fecha < public.hoy_local() or p_fecha > public.hoy_local() + 180 then raise exception 'PASO_INVALIDO: elige un día entre hoy y los próximos 6 meses' using errcode = 'check_violation'; end if;
  update public.crm_oportunidades set proximo_paso = v_txt, proximo_at = p_fecha, updated_at = now()
   where id = p_id and etapa not in ('ganado', 'perdido') returning * into o;
  if not found then raise exception 'PASO_INVALIDO: la oportunidad ya está cerrada' using errcode = 'check_violation'; end if;
  return public._crm_json(o);
end;
$$;

-- Aviso diario a cada vendedor: lo que le toca hoy y lo quieto.
create function public._crm_avisar_quietas() returns integer language plpgsql security definer set search_path = public as
$$
declare r record; n int := 0; v_hoy date := public.hoy_local();
begin
  if extract(isodow from v_hoy) = 7 then return 0; end if;
  for r in select o.seller_profile_id s,
                  count(*) filter (where o.proximo_at = v_hoy) hoy,
                  count(*) filter (where o.proximo_at < v_hoy) vencidas,
                  count(*) filter (where o.proximo_at is null and now() - o.etapa_at >= interval '5 days') sin_paso
             from public.crm_oportunidades o
            where o.etapa not in ('ganado', 'perdido') and o.seller_profile_id is not null
            group by o.seller_profile_id
           having count(*) filter (where o.proximo_at <= v_hoy or (o.proximo_at is null and now() - o.etapa_at >= interval '5 days')) > 0 loop
    perform public._cc_notificar('crm_quietas', null, array[r.s], null,
      'Tu embudo hoy: ' || concat_ws(', ',
        case when r.hoy > 0 then r.hoy || case when r.hoy = 1 then ' paso que toca hoy' else ' pasos que tocan hoy' end end,
        case when r.vencidas > 0 then r.vencidas || case when r.vencidas = 1 then ' paso vencido' else ' pasos vencidos' end end,
        case when r.sin_paso > 0 then r.sin_paso || case when r.sin_paso = 1 then ' oportunidad quieta sin próximo paso' else ' oportunidades quietas sin próximo paso' end end) || '.',
      'crm_embudo', 'crm_quietas:' || r.s::text || ':' || v_hoy::text);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public._crm_quieta(public.crm_oportunidades), public._crm_avisar_quietas() from public, anon, authenticated;
revoke all on function public.crm_paso(uuid, text, date) from public, anon;
grant execute on function public.crm_paso(uuid, text, date) to authenticated;
-- 16:00 UTC = 9:00 en Mazatlán (UTC-7, sin horario de verano)
select cron.schedule('renovacell-crm-quietas', '0 16 * * 1-6', 'select public._crm_avisar_quietas()');

do $post$ begin
  if position('''quieta''' in pg_get_functiondef('public._crm_json(public.crm_oportunidades)'::regprocedure)) = 0 then raise exception 'CRM-PASO: parche de _crm_json no aplicado'; end if;
  if not exists (select 1 from cron.job where jobname = 'renovacell-crm-quietas') then raise exception 'CRM-PASO: falta la tarea programada'; end if;
end $post$;
