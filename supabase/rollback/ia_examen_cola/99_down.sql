-- IA EXAMEN COLA (20270303) · down: sin cola ni cron; crear/registrar/resumen vuelven a la 20270228 (la pantalla corría caso por caso).
do $cron$ declare r record; begin for r in select jobid from cron.job where jobname = 'renovacell-ia-examen' loop perform cron.unschedule(r.jobid); end loop; end $cron$;
drop function if exists public.ia_examen_despachar();
drop function if exists public.ia_examen_detener(uuid);
drop function if exists public.ia_examen_continuar(uuid);
drop table if exists public.cc_ia_examen_cola;
create or replace function public.ia_examen_crear(p_modelo text, p_perfil uuid, p_esfuerzo text default 'low', p_casos text[] default null, p_nota text default null) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_casos text[];
begin
  perform public._cc_exige_admin();
  if not exists (select 1 from public.profiles where id = p_perfil and role_id = 'doctor' and verified and active) then
    raise exception 'PERFIL_INVALIDO: el examen se corre como un doctor verificado y activo' using errcode = 'check_violation';
  end if;
  select array_agg(id order by id) into v_casos from public.cc_ia_examen_casos where activo and (p_casos is null or id = any (p_casos));
  if coalesce(array_length(v_casos, 1), 0) = 0 then raise exception 'SIN_CASOS' using errcode = 'check_violation'; end if;
  insert into public.cc_ia_examen_corridas (modelo, esfuerzo, perfil_id, casos, nota, creada_por)
  values (p_modelo, coalesce(p_esfuerzo, 'low'), p_perfil, v_casos, left(p_nota, 300), auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
create or replace function public.ia_examen_registrar(p_corrida uuid, p_caso text, p_r jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform public._cc_solo_servicio();
  insert into public.cc_ia_examen_resultados (corrida_id, caso_id, respuesta, estado, motivo_validacion, herramientas, evidencia, latencia_ms, tokens_in, tokens_out, costo_usd, puntaje, aprobado, juicio, error)
  values (p_corrida, p_caso, left(p_r ->> 'respuesta', 6000), coalesce(p_r ->> 'estado', 'error'), p_r ->> 'motivo_validacion', coalesce(p_r -> 'herramientas', '[]'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_r -> 'evidencia', '[]')) x), '{}'),
          (p_r ->> 'latencia_ms')::int, (p_r ->> 'tokens_in')::int, (p_r ->> 'tokens_out')::int, (p_r ->> 'costo_usd')::numeric,
          (p_r ->> 'puntaje')::numeric, (p_r ->> 'aprobado')::boolean, p_r -> 'juicio', left(p_r ->> 'error', 500))
  on conflict (corrida_id, caso_id) do update set respuesta = excluded.respuesta, estado = excluded.estado, motivo_validacion = excluded.motivo_validacion,
    herramientas = excluded.herramientas, evidencia = excluded.evidencia, latencia_ms = excluded.latencia_ms, tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
    costo_usd = excluded.costo_usd, puntaje = excluded.puntaje, aprobado = excluded.aprobado, juicio = excluded.juicio, error = excluded.error, created_at = now();
end;
$$;
create or replace function public.ia_examen_corridas() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc_exige_admin();
  return coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
    select jsonb_build_object('id', r.id, 'modelo', r.modelo, 'esfuerzo', r.esfuerzo, 'nota', r.nota, 'created_at', r.created_at,
      'perfil', (select full_name from public.profiles where id = r.perfil_id),
      'casos', array_length(r.casos, 1), 'corridos', count(s.caso_id),
      'puntaje', round(avg(s.puntaje), 1), 'aprobados', count(*) filter (where s.aprobado),
      'rechazos_validacion', count(*) filter (where s.motivo_validacion is not null), 'errores', count(*) filter (where s.estado <> 'respondio'),
      'latencia_p50', percentile_cont(0.5) within group (order by s.latencia_ms), 'latencia_p90', percentile_cont(0.9) within group (order by s.latencia_ms),
      'costo_promedio_usd', round(avg(s.costo_usd), 5),
      'por_categoria', (select jsonb_object_agg(cat, p) from (select c.categoria cat, round(avg(s2.puntaje), 1) p from public.cc_ia_examen_resultados s2 join public.cc_ia_examen_casos c on c.id = s2.caso_id where s2.corrida_id = r.id group by 1) z)) x
      from public.cc_ia_examen_corridas r left join public.cc_ia_examen_resultados s on s.corrida_id = r.id
     group by r.id order by r.created_at desc limit 30) q), '[]'::jsonb);
end;
$$;
alter table public.cc_ia_examen_corridas drop column if exists estado;
