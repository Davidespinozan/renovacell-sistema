-- ============================================================================
-- W6-A3.1 · SALUD DEL CRON — que un proceso automático pueda decir que no corrió
--
-- Hechos que ordenan este archivo (medidos en producción, 106/106):
--   · El único job (`renovacell-alertas-diarias`, 15:00 UTC) falló 35 corridas seguidas
--     (17-ago → 20-sep) sin que nadie lo viera: `avisar_cuentas_por_cobrar()` escribe en
--     `orders` sin autoridad y `orders_guard()` la rechaza. Es una función anterior a W2
--     (mira `payment_status`, "7 días desde el pedido"); la cobranza real vive en
--     `v_order_money` y en las colas "Por cobrar" y "Crédito vencido" de la bandeja.
--   · `avisar_lotes_por_caducar()` funciona, pero corta el día con CURRENT_DATE (UTC):
--     coincide con Mazatlán solo porque el job corre a las 15:00 UTC. Pasa a `hoy_local()`.
--
-- Decisiones del dueño: retirar la cobranza automática sin sustituto que escriba sobre
-- `orders`; conservar la columna `cobranza_avisada_at` (vacía, sin lectores).
--
-- Semántica transaccional (demostrada en tests/w6a3_00_transaccion.sql): pg_cron corre
-- el job en UNA transacción; un UPDATE seguido de RAISE se revierte. Por eso:
--   · `sistema_latidos` guarda solo lo que REALMENTE se puede persistir: el último OK
--     (escrito DESPUÉS del trabajo, en la misma transacción) y el último error (escrito
--     en el manejador de excepciones, sin relanzar, con el trabajo ya revertido).
--   · Si el propio latido falla, la excepción sube y queda en `cron.job_run_details`.
--   · `salud_sistema()` combina las dos fuentes: latidos (OK / error capturado) y el
--     registro de pg_cron (fallos de infraestructura, corridas en curso o muertas).
--     No se duplica el historial que pg_cron ya guarda.
--
-- Rollback: supabase/rollback/w6a3/99_down.sql (restaura las dos funciones originales
-- y el job anterior; no hay datos de negocio que proteger).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) La cobranza automática legacy se retira (0 consumidores: ni UI, ni edges, ni RPC,
--    ni KPI, ni tests). La columna `cobranza_avisada_at` se conserva sin lectores.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regproc('cron.unschedule') is not null
     and exists (select 1 from cron.job where jobname = 'renovacell-alertas-diarias') then
    perform cron.unschedule('renovacell-alertas-diarias');
  end if;
exception when others then
  raise notice 'pg_cron no disponible al retirar el job (%).', sqlerrm;
end $$;
drop function if exists public.avisar_cuentas_por_cobrar();

-- ---------------------------------------------------------------------------
-- 2) Aviso de lotes: mismo contrato, día del NEGOCIO. Sigue SECURITY DEFINER (ya lo era:
--    escribe en lots/notifications como dueño) y sin acceso para clientes.
-- ---------------------------------------------------------------------------
create or replace function public.avisar_lotes_por_caducar()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record; v_hoy date := public.hoy_local();
begin
  for r in
    select l.id, l.lot_code, l.quantity, p.name as producto,
           (l.expiry_date - v_hoy) as dias
    from public.lots l join public.products p on p.id = l.product_id
    where l.quantity > 0
      and l.expiry_date is not null
      and l.expiry_date <= v_hoy + 60          -- por vencer (≤60d) o ya caducado
      and (l.caducidad_avisada_at is null or l.caducidad_avisada_at < now() - interval '14 days')
  loop
    insert into public.notifications (body, roles, screen)
    values (
      case when r.dias < 0
        then format('Lote CADUCADO: %s (%s) · %s u — dar de baja', r.producto, r.lot_code, r.quantity)
        else format('Lote por caducar en %s días: %s (%s) · %s u', r.dias, r.producto, r.lot_code, r.quantity)
      end,
      array['warehouse','admin'], 'caduc');
    update public.lots set caducidad_avisada_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

-- ---------------------------------------------------------------------------
-- 3) Latidos: ESTADO ACTUAL por fuente (una fila), no un historial.
-- ---------------------------------------------------------------------------
create table public.sistema_latidos (
  fuente        text primary key check (fuente in ('alertas_diarias')),
  ultimo_ok     timestamptz,
  ultimo_error  timestamptz,
  detalle       text check (detalle is null or length(detalle) <= 200),
  duracion_ms   integer,
  procesados    integer,
  actualizado   timestamptz not null default now()
);
comment on table public.sistema_latidos is
  'W6-A3 · último OK / último error capturado por proceso automático. Lo escribe solo el propio proceso; se lee solo por salud_sistema().';
alter table public.sistema_latidos enable row level security;   -- sin políticas: nadie entra por RLS
revoke all on public.sistema_latidos from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) El envoltorio que corre el job. Sin SECURITY DEFINER: lo ejecuta el dueño (pg_cron).
--    Nunca relanza: así el error queda persistido (ver experimento). Si el propio latido
--    falla, la excepción sube y la registra pg_cron. Los sellos usan clock_timestamp():
--    now() es constante dentro de la transacción y "error después de OK" debe ordenarse.
-- ---------------------------------------------------------------------------
create function public.correr_alertas_diarias() returns jsonb
  language plpgsql set search_path = public as $$
declare t0 timestamptz := clock_timestamp(); n int; v_err text;
begin
  insert into public.sistema_latidos (fuente) values ('alertas_diarias') on conflict (fuente) do nothing;
  begin
    n := public.avisar_lotes_por_caducar();
    update public.sistema_latidos
       set ultimo_ok = clock_timestamp(), procesados = n, detalle = null,
           duracion_ms = round(extract(epoch from (clock_timestamp() - t0)) * 1000)::int, actualizado = clock_timestamp()
     where fuente = 'alertas_diarias';
    return jsonb_build_object('estado', 'ok', 'procesados', n);
  exception when others then
    -- SQLERRM es solo el mensaje (sin CONTEXT ni SQL): apto para mostrarse.
    v_err := left(sqlerrm, 200);
    update public.sistema_latidos
       set ultimo_error = clock_timestamp(), detalle = v_err,
           duracion_ms = round(extract(epoch from (clock_timestamp() - t0)) * 1000)::int, actualizado = clock_timestamp()
     where fuente = 'alertas_diarias';
    return jsonb_build_object('estado', 'error', 'detalle', v_err);
  end;
end; $$;
revoke all on function public.correr_alertas_diarias() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Salud para Dirección. SECURITY DEFINER con razón demostrable: debe leer
--    `sistema_latidos` (sin RLS para nadie) y `cron.job_run_details` (esquema sin USAGE
--    para clientes). Entrega mensajes operativos; nunca SQL, CONTEXT ni comandos.
--
--    Estados (precedencia RUNNING > STALE > FAILED > OK):
--      RUNNING  pg_cron tiene una corrida en curso (< 10 min).
--      STALE    sin OK en 26 h (job diario a las 15:00 UTC + 2 h de margen); también si
--               nunca ha corrido bien.
--      FAILED   el último intento falló: error capturado en latidos, o fallo/corrida
--               muerta en pg_cron posterior al último OK.
--      OK       lo demás.
-- ---------------------------------------------------------------------------
create function public._salud_umbral_stale() returns interval language sql immutable as $$ select interval '26 hours' $$;
create function public._salud_umbral_running() returns interval language sql immutable as $$ select interval '10 minutes' $$;

create function public.salud_sistema() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  l public.sistema_latidos; v_cron boolean; r record; v_estado text; v_msg text;
  v_corridas int := 0; v_fallidas int := 0; v_ultima_fallida timestamptz; v_motivo text; v_running boolean := false;
  v_fallo_cron boolean := false; v_fallo_latido boolean;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: la salud del sistema es de Dirección';
  end if;
  select * into l from public.sistema_latidos where fuente = 'alertas_diarias';
  v_cron := to_regclass('cron.job_run_details') is not null;
  if v_cron then
    select count(*)::int, count(*) filter (where d.status = 'failed')::int,
           max(d.start_time) filter (where d.status = 'failed')
      into v_corridas, v_fallidas, v_ultima_fallida
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = 'renovacell-alertas-diarias' and d.start_time > now() - interval '7 days';
    select d.status, d.start_time, d.return_message into r
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = 'renovacell-alertas-diarias' order by d.start_time desc limit 1;
    if found then
      if r.status in ('starting', 'running', 'connecting', 'sending') then
        if r.start_time > now() - public._salud_umbral_running() then v_running := true;
        else v_fallo_cron := r.start_time > coalesce(l.ultimo_ok, '-infinity'); v_motivo := 'la ejecución no terminó'; end if;
      elsif r.status = 'failed' and r.start_time > coalesce(l.ultimo_ok, '-infinity') then
        v_fallo_cron := true;
        -- Primera línea del mensaje, sin el prefijo de Postgres ni contexto interno.
        v_motivo := left(regexp_replace(split_part(coalesce(r.return_message, ''), E'\n', 1), '^ERROR:\s*', ''), 200);
      end if;
    end if;
  end if;
  v_fallo_latido := l.ultimo_error is not null and l.ultimo_error > coalesce(l.ultimo_ok, '-infinity');

  if v_running then v_estado := 'RUNNING';
  elsif l.ultimo_ok is null or l.ultimo_ok < now() - public._salud_umbral_stale() then v_estado := 'STALE';
  elsif v_fallo_latido or v_fallo_cron then v_estado := 'FAILED';
  else v_estado := 'OK'; end if;

  v_msg := case v_estado
    when 'RUNNING' then 'Las alertas automáticas se están ejecutando.'
    when 'STALE' then case when l.ultimo_ok is null then 'Las alertas automáticas nunca se han ejecutado correctamente.'
                           else format('Alertas automáticas sin ejecutarse correctamente desde el %s.', to_char(l.ultimo_ok at time zone 'America/Mazatlan', 'DD/MM/YYYY HH24:MI')) end
    when 'FAILED' then format('La última ejecución de las alertas automáticas falló (%s).', coalesce(case when v_fallo_latido then l.detalle end, v_motivo, 'motivo no disponible'))
    else null end;

  return jsonb_build_object(
    'fuente', 'alertas_diarias', 'estado', v_estado, 'mensaje', v_msg,
    'ultimo_ok', l.ultimo_ok, 'horas_desde_ok', case when l.ultimo_ok is null then null else round(extract(epoch from (now() - l.ultimo_ok)) / 3600, 1) end,
    'ultimo_error', l.ultimo_error, 'detalle', case when v_fallo_latido then l.detalle end,
    'procesados', l.procesados, 'duracion_ms', l.duracion_ms,
    'cron', jsonb_build_object('disponible', v_cron, 'corridas_7d', v_corridas, 'fallidas_7d', v_fallidas, 'ultima_fallida', v_ultima_fallida,
                               'motivo', case when v_fallo_cron then v_motivo end),
    'umbral_stale_horas', extract(epoch from public._salud_umbral_stale()) / 3600);
end; $$;
revoke all on function public.salud_sistema() from public, anon;
grant execute on function public.salud_sistema() to authenticated;
revoke all on function public._salud_umbral_stale(), public._salud_umbral_running() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Higiene: pg_cron concede SELECT a PUBLIC sobre su esquema por defecto. Ningún cliente
--    lo necesita (la salud sale de salud_sistema()). Best-effort: si el dueño del esquema
--    no lo permite, se avisa y no se aborta.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job_run_details') is not null then
    revoke select on cron.job, cron.job_run_details from public;
  end if;
exception when others then
  raise notice 'no se pudo retirar SELECT de cron.* a PUBLIC (%).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 7) El job vuelve a agendarse con el envoltorio (mismo horario: 15:00 UTC = 09:00 Mazatlán
--    en horario normal; la FECHA la fija hoy_local(), no la hora del job).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regproc('cron.schedule') is null then
    raise notice 'pg_cron no disponible: agendar "select public.correr_alertas_diarias()" aparte.';
    return;
  end if;
  perform cron.schedule('renovacell-alertas-diarias', '0 15 * * *', 'select public.correr_alertas_diarias();');
exception when others then
  raise notice 'pg_cron no disponible al agendar (%).', sqlerrm;
end $$;
