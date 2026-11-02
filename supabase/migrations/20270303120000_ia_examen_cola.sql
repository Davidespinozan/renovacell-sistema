-- ============================================================================
-- EXAMEN DE LA IA · lo corre el SERVIDOR (2 nov 2026). Antes la pantalla iba caso por caso desde el navegador: al
-- actualizar o cerrar, el examen se detenía. Ahora crear la corrida encola sus casos y un cron (cada minuto) los manda a
-- la Edge ia-examen de a varios con el secreto del cron; la Edge responde de inmediato y trabaja en segundo plano. Un caso
-- que no regresa se reintenta (hasta 3 veces). La pantalla solo muestra el avance; una corrida a medias se puede
-- continuar y una en curso, detener.
-- ============================================================================
alter table public.cc_ia_examen_corridas add column if not exists estado text not null default 'terminada' check (estado in ('en_curso', 'terminada', 'detenida'));
alter table public.cc_ia_examen_corridas alter column estado set default 'en_curso';

create table if not exists public.cc_ia_examen_cola (
  corrida_id uuid not null references public.cc_ia_examen_corridas(id) on delete cascade,
  caso_id text not null, intentos int not null default 0, tomado_at timestamptz,
  primary key (corrida_id, caso_id));
alter table public.cc_ia_examen_cola enable row level security;
revoke all on public.cc_ia_examen_cola from public, anon, authenticated;

-- Crear encola todos sus casos.
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
  insert into public.cc_ia_examen_corridas (modelo, esfuerzo, perfil_id, casos, nota, creada_por, estado)
  values (p_modelo, coalesce(p_esfuerzo, 'low'), p_perfil, v_casos, left(p_nota, 300), auth.uid(), 'en_curso') returning id into v_id;
  insert into public.cc_ia_examen_cola (corrida_id, caso_id) select v_id, unnest(v_casos);
  return v_id;
end;
$$;

-- Continuar: vuelve a encolar lo que no tiene resultado (o lo que falló sin respuesta).
create or replace function public.ia_examen_continuar(p_corrida uuid) returns int
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  perform public._cc_exige_admin();
  insert into public.cc_ia_examen_cola (corrida_id, caso_id)
  select r.id, k.id from public.cc_ia_examen_corridas r cross join lateral unnest(r.casos) k(id)
   where r.id = p_corrida and not exists (select 1 from public.cc_ia_examen_resultados s where s.corrida_id = r.id and s.caso_id = k.id and s.respuesta is not null and s.respuesta <> '')
  on conflict (corrida_id, caso_id) do update set intentos = 0, tomado_at = null;
  get diagnostics n = row_count;
  update public.cc_ia_examen_corridas set estado = case when n > 0 then 'en_curso' else 'terminada' end where id = p_corrida;
  return n;
end;
$$;

create or replace function public.ia_examen_detener(p_corrida uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  perform public._cc_exige_admin();
  delete from public.cc_ia_examen_cola where corrida_id = p_corrida;
  update public.cc_ia_examen_corridas set estado = 'detenida' where id = p_corrida and estado = 'en_curso';
end;
$$;

-- Registrar el resultado también saca el caso de la cola y cierra la corrida cuando ya no queda nada.
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
  delete from public.cc_ia_examen_cola where corrida_id = p_corrida and caso_id = p_caso;
  if not exists (select 1 from public.cc_ia_examen_cola where corrida_id = p_corrida) then
    update public.cc_ia_examen_corridas set estado = 'terminada' where id = p_corrida and estado = 'en_curso';
  end if;
end;
$$;

-- Cron: manda a la Edge hasta 8 casos (los que no están en vuelo o llevan más de 4 min sin regresar); al tercer intento
-- fallido el caso se registra como error y sale de la cola.
create or replace function public.ia_examen_despachar() returns int
  language plpgsql security definer set search_path = public as
$$
declare q record; v_url text; v_secreto text; n int := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
  if v_url is null or v_secreto is null then return 0; end if;
  for q in select c.* from public.cc_ia_examen_cola c
            where c.tomado_at is null or c.tomado_at < now() - interval '4 minutes'
            order by c.tomado_at nulls first, c.caso_id limit 8 for update skip locked loop
    if q.intentos >= 3 then
      -- (el cron corre como dueño de la base, no como service_role: se registra aquí mismo)
      insert into public.cc_ia_examen_resultados (corrida_id, caso_id, estado, puntaje, aprobado, error)
      values (q.corrida_id, q.caso_id, 'fallo', 0, false, 'sin_respuesta_tras_3_intentos')
      on conflict (corrida_id, caso_id) do update set estado = 'fallo', puntaje = 0, aprobado = false, error = 'sin_respuesta_tras_3_intentos', created_at = now();
      delete from public.cc_ia_examen_cola where corrida_id = q.corrida_id and caso_id = q.caso_id;
      if not exists (select 1 from public.cc_ia_examen_cola where corrida_id = q.corrida_id) then
        update public.cc_ia_examen_corridas set estado = 'terminada' where id = q.corrida_id and estado = 'en_curso';
      end if;
      continue;
    end if;
    update public.cc_ia_examen_cola set intentos = intentos + 1, tomado_at = now() where corrida_id = q.corrida_id and caso_id = q.caso_id;
    perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/ia-examen',
                          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                          body := jsonb_build_object('corrida_id', q.corrida_id, 'caso_id', q.caso_id), timeout_milliseconds := 15000);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- El resumen dice cuántos faltan y el estado.
create or replace function public.ia_examen_corridas() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc_exige_admin();
  return coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
    select jsonb_build_object('id', r.id, 'modelo', r.modelo, 'esfuerzo', r.esfuerzo, 'nota', r.nota, 'created_at', r.created_at, 'estado', r.estado,
      'perfil', (select full_name from public.profiles where id = r.perfil_id),
      'casos', array_length(r.casos, 1), 'corridos', count(s.caso_id), 'pendientes', (select count(*) from public.cc_ia_examen_cola c where c.corrida_id = r.id),
      'puntaje', round(avg(s.puntaje), 1), 'aprobados', count(*) filter (where s.aprobado),
      'rechazos_validacion', count(*) filter (where s.motivo_validacion is not null), 'errores', count(*) filter (where s.estado <> 'respondio'),
      'latencia_p50', percentile_cont(0.5) within group (order by s.latencia_ms), 'latencia_p90', percentile_cont(0.9) within group (order by s.latencia_ms),
      'costo_promedio_usd', round(avg(s.costo_usd), 5),
      'por_categoria', (select jsonb_object_agg(cat, p) from (select c.categoria cat, round(avg(s2.puntaje), 1) p from public.cc_ia_examen_resultados s2 join public.cc_ia_examen_casos c on c.id = s2.caso_id where s2.corrida_id = r.id group by 1) z)) x
      from public.cc_ia_examen_corridas r left join public.cc_ia_examen_resultados s on s.corrida_id = r.id
     group by r.id order by r.created_at desc limit 30) q), '[]'::jsonb);
end;
$$;

-- Lo que ya existía antes de esta migración: las corridas a medias quedan 'detenida' (se pueden continuar).
update public.cc_ia_examen_corridas r set estado = 'detenida'
 where r.estado = 'en_curso' or (select count(*) from public.cc_ia_examen_resultados s where s.corrida_id = r.id) < array_length(r.casos, 1);

do $g$ begin
  execute 'revoke all on function public.ia_examen_continuar(uuid), public.ia_examen_detener(uuid), public.ia_examen_despachar() from public, anon';
  execute 'grant execute on function public.ia_examen_continuar(uuid), public.ia_examen_detener(uuid) to authenticated';
  execute 'revoke all on function public.ia_examen_despachar() from authenticated';
end $g$;

do $cron$
declare r record;
begin
  for r in select jobid from cron.job where jobname = 'renovacell-ia-examen' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('renovacell-ia-examen'::text, '* * * * *'::text, 'select public.ia_examen_despachar();'::text);
end $cron$;
do $post$ begin
  if (select count(*) from cron.job where jobname = 'renovacell-ia-examen' and active) <> 1 then raise exception 'IA-EXAMEN-COLA: falta el cron'; end if;
end $post$;
