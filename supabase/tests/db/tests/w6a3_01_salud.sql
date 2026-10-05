-- W6-A3.1 · Salud del cron: estados derivados de lo que REALMENTE persiste (latidos +
-- registro de pg_cron), aviso de lotes en día del negocio, autoridad y retiro de la
-- cobranza legacy sin perder visibilidad de las cuentas vencidas.
begin;
-- Ajusta el latido a mano para simular el paso del tiempo (solo pruebas).
create function pg_temp.latido(p_ok timestamptz, p_err timestamptz default null, p_det text default null) returns void language sql as $$
  update public.sistema_latidos set ultimo_ok = p_ok, ultimo_error = p_err, detalle = p_det where fuente = 'alertas_diarias' $$;
create function pg_temp.corrida(p_status text, p_start timestamptz, p_msg text default null) returns void language sql as $$
  insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
  select j.jobid, p_status, p_msg, p_start, case when p_status in ('succeeded','failed') then p_start + interval '150 milliseconds' end
    from cron.job j where j.jobname = 'renovacell-alertas-diarias' $$;
create function pg_temp.salud() returns jsonb language plpgsql as $$
declare v_claims text := current_setting('request.jwt.claims', true); v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.fixture_admin(), 'role', 'authenticated')::text, true);
  v := public.salud_sistema();
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return v;
end $$;

do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_p uuid := tests.product(100);
  v_l uuid; v_l2 uuid; v_o uuid; r jsonb; s jsonb; n_notif int; v_hoy date := public.hoy_local(); v_cd1 date; v_cd2 date; v_hl1 date; v_hl2 date;
begin
  -- ══ 1) Cobranza legacy: retirada sin sustituto y sin perder visibilidad ═══════
  perform tests.ok(to_regproc('public.avisar_cuentas_por_cobrar') is null, 'avisar_cuentas_por_cobrar() ya no existe');
  perform tests.ok(exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'cobranza_avisada_at'),
    'la columna cobranza_avisada_at se conserva (compatibilidad, sin lectores)');
  perform tests.eq((select command from cron.job where jobname = 'renovacell-alertas-diarias'), 'select public.correr_alertas_diarias();',
    'el job ejecuta el envoltorio y ya no la cobranza');
  perform tests.eq((select schedule from cron.job where jobname = 'renovacell-alertas-diarias'), '0 15 * * *', 'mismo horario');
  perform tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%cobranza_avisada_at%'),
    'ninguna función de public lee ni escribe cobranza_avisada_at');
  perform tests.ok(not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%cobranza_avisada_at%'),
    'ningún trigger la usa');
  -- Un crédito vencido sigue visible por v_order_money (lo que lee la bandeja), sin sello.
  perform tests.stock(v_p, 'W6A3-C', 10);
  v_o := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  -- Crédito vencido como lo hace W2 en sus pruebas: concesión antigua (el libro es append-only).
  insert into public.credit_grants (id, order_id, due_date, reason, granted_by, granted_at)
  values (gen_random_uuid(), v_o, public.hoy_local() - 3, 'crédito viejo', v_admin, now() - interval '30 days');
  perform tests.ok((select vencido and saldo > 0 from public.v_order_money where order_id = v_o),
    'un crédito vencido aparece en v_order_money (cola "Crédito vencido") sin ningún sello de cobranza');
  perform tests.eq((select count(*)::int from public.orders where cobranza_avisada_at is not null), 0, 'y nadie escribió cobranza_avisada_at');

  -- ══ 2) Lotes: día del negocio ════════════════════════════════════════════════
  perform tests.ok(position('hoy_local()' in pg_get_functiondef('public.avisar_lotes_por_caducar()'::regprocedure)) > 0
               and position('CURRENT_DATE' in pg_get_functiondef('public.avisar_lotes_por_caducar()'::regprocedure)) = 0,
    'avisar_lotes_por_caducar usa hoy_local() y no CURRENT_DATE');
  v_l  := tests.stock(v_p, 'W6A3-60', 5, v_hoy + 60);   -- justo en el borde: SÍ avisa
  v_l2 := tests.stock(v_p, 'W6A3-61', 5, v_hoy + 61);   -- un día después: NO
  select count(*) into n_notif from public.notifications where screen = 'caduc';
  perform tests.eq(public.avisar_lotes_por_caducar(), 1, 'avisa exactamente el lote a 60 días del día del negocio');
  perform tests.eq((select count(*)::int from public.notifications where screen = 'caduc') - n_notif, 1, 'una notificación nueva');
  perform tests.ok((select caducidad_avisada_at is not null from public.lots where id = v_l) and (select caducidad_avisada_at is null from public.lots where id = v_l2),
    'sello solo en el lote avisado');
  perform tests.eq(public.avisar_lotes_por_caducar(), 0, 'volver a correr el mismo día no duplica (sello de 14 días)');
  -- La fecha no depende de la zona de la sesión ni de la hora del job: dos sesiones a 26 h
  -- de distancia (UTC-12 y UTC+14) ven el MISMO hoy_local(), pero CURRENT_DATE cambia en una.
  set local timezone = 'Etc/GMT+12'; v_cd1 := current_date; v_hl1 := public.hoy_local();
  set local timezone = 'Etc/GMT-14'; v_cd2 := current_date; v_hl2 := public.hoy_local();
  set local timezone = 'UTC';
  perform tests.ok(v_hl1 = v_hl2 and v_hl1 = v_hoy, 'hoy_local() no cambia con la zona de la sesión');
  perform tests.ok(v_cd1 <> v_cd2, 'CURRENT_DATE sí cambia (por eso se retiró): ' || v_cd1 || ' vs ' || v_cd2);
  perform tests.eq(public.dia_negocio('2026-11-01T06:30:00Z'::timestamptz), '2026-10-31'::date,
    '23:30 Mazatlán del 31-oct es 31-oct para la caducidad (en UTC ya sería 1-nov)');

  -- ══ 3) Latidos: corrida OK y corrida sin datos ═══════════════════════════════
  perform set_config('app.trusted', 'on', true); update public.lots set caducidad_avisada_at = null where id = v_l; perform set_config('app.trusted', 'off', true);
  r := public.correr_alertas_diarias();
  perform tests.eq(r ->> 'estado', 'ok', 'A) corrida OK');
  perform tests.eq((r ->> 'procesados')::int, 1, 'A) procesados = avisos emitidos');
  s := pg_temp.salud();
  perform tests.eq(s ->> 'estado', 'OK', 'A) salud = OK');
  perform tests.ok(s -> 'mensaje' = 'null'::jsonb, 'A) sin mensaje cuando todo está sano (sin ruido)');
  perform tests.ok((select ultimo_ok is not null and ultimo_error is null and procesados = 1 and duracion_ms >= 0 from public.sistema_latidos), 'A) latido completo');
  r := public.correr_alertas_diarias();
  perform tests.eq((r ->> 'procesados')::int, 0, 'B) corrida sin nada que procesar');
  perform tests.eq(pg_temp.salud() ->> 'estado', 'OK', 'B) sin datos = OK (no es un fallo)');
  perform tests.eq(pg_temp.salud() ->> 'estado', 'OK', 'I) ejecución duplicada: sigue OK, 0 avisos nuevos');

  -- ══ 4) Fallo del trabajo (C/D): se persiste el error; el OK anterior se conserva ══
  -- Se fuerza el fallo haciendo que la función de trabajo lance (se restaura después).
  create or replace function public.avisar_lotes_por_caducar() returns integer language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.notifications (body, roles, screen) values ('a medias', array['admin'], 'caduc');
    raise exception 'FALLA_SIMULADA: el almacén no respondió';
  end $f$;
  select count(*) into n_notif from public.notifications;
  r := public.correr_alertas_diarias();
  perform tests.eq(r ->> 'estado', 'error', 'C) la corrida reporta error sin relanzar');
  perform tests.eq((select count(*)::int from public.notifications), n_notif, 'C) el trabajo a medias se revirtió (subtransacción)');
  perform tests.ok((select ultimo_error > ultimo_ok and detalle = 'FALLA_SIMULADA: el almacén no respondió' from public.sistema_latidos),
    'D) ultimo_error PERSISTE (no se relanzó) y el detalle es solo el mensaje');
  s := pg_temp.salud();
  perform tests.eq(s ->> 'estado', 'FAILED', 'C/D) salud = FAILED');
  perform tests.ok(s ->> 'mensaje' like 'La última ejecución de las alertas automáticas falló (FALLA_SIMULADA%', 'C/D) mensaje operativo con el motivo');
  perform tests.ok(position('CONTEXT' in s::text) = 0 and position('PL/pgSQL' in s::text) = 0 and position('SQL statement' in s::text) = 0,
    'la salud no expone contexto interno');

  -- ══ 5) Fallo del propio latido (J): la excepción sube; lo registra pg_cron ═══
  create or replace function public.avisar_lotes_por_caducar() returns integer language plpgsql security definer set search_path = public as $f$
  begin raise exception 'FALLA_SIMULADA 2'; end $f$;
  update public.sistema_latidos set detalle = null;   -- la fila actual debe cumplir la restricción temporal
  alter table public.sistema_latidos add constraint tmp_detalle_corto check (detalle is null or length(detalle) < 5);
  begin
    perform public.correr_alertas_diarias();
    perform tests.ok(false, 'J) debía propagar');
  exception when others then
    perform tests.ok(sqlerrm like '%tmp_detalle_corto%', 'J) si el latido no se puede escribir, la excepción sube (pg_cron la registra como failed)');
  end;
  alter table public.sistema_latidos drop constraint tmp_detalle_corto;

  -- ══ 6) Fuente pg_cron: fallo de infraestructura y corrida muerta (E/F) ══════
  perform pg_temp.latido(now() - interval '2 hours');                       -- último OK hace 2 h
  perform pg_temp.corrida('failed', now() - interval '1 hour', E'ERROR:  connection to server failed\nCONTEXT:  interno');
  s := pg_temp.salud();
  perform tests.eq(s ->> 'estado', 'FAILED', 'F) un fallo en job_run_details posterior al último OK = FAILED');
  perform tests.ok(s ->> 'mensaje' = 'La última ejecución de las alertas automáticas falló (connection to server failed).', 'F) motivo = primera línea sin prefijo ni CONTEXT');
  perform tests.eq((s -> 'cron' ->> 'fallidas_7d')::int, 1, 'F) conteo de fallidas en 7 días');
  perform pg_temp.corrida('succeeded', now() - interval '30 minutes', '1 row'); perform pg_temp.latido(now() - interval '30 minutes');
  perform tests.eq(pg_temp.salud() ->> 'estado', 'OK', 'F) una corrida OK posterior vuelve a OK');
  perform pg_temp.corrida('running', now() - interval '2 minutes');
  perform tests.eq(pg_temp.salud() ->> 'estado', 'RUNNING', 'E) corrida en curso reciente = RUNNING');
  delete from cron.job_run_details where status = 'running';
  -- Proceso muerto: la corrida MÁS RECIENTE quedó en 'running' hace horas, sin OK posterior.
  delete from cron.job_run_details;
  perform pg_temp.latido(now() - interval '5 hours');
  perform pg_temp.corrida('running', now() - interval '3 hours');
  s := pg_temp.salud();
  perform tests.eq(s ->> 'estado', 'FAILED', 'E) proceso que nunca terminó (> 10 min) = FAILED');
  perform tests.ok(s ->> 'mensaje' like '%la ejecución no terminó%', 'E) con su motivo');
  delete from cron.job_run_details where status = 'running';

  -- ══ 7) STALE: umbral de 26 h, sin falsos positivos ════════════════════════════
  perform pg_temp.latido(now() - interval '25 hours 59 minutes');
  perform tests.eq(pg_temp.salud() ->> 'estado', 'OK', 'H) 25h59 sin OK: todavía OK (no false-stale)');
  perform pg_temp.latido(now() - interval '26 hours 1 minute');
  s := pg_temp.salud();
  perform tests.eq(s ->> 'estado', 'STALE', 'G) 26h01 sin OK: STALE');
  perform tests.ok(s ->> 'mensaje' like 'Alertas automáticas sin ejecutarse correctamente desde el %', 'G) mensaje con la fecha del último OK');
  perform pg_temp.latido(now() - interval '30 hours', now() - interval '20 hours', 'x');
  perform tests.eq(pg_temp.salud() ->> 'estado', 'STALE', 'G) con fallo reciente pero sin OK en 26 h manda STALE (lo que importa es que no ha corrido bien)');
  delete from public.sistema_latidos;
  perform tests.eq(pg_temp.salud() ->> 'estado', 'STALE', 'nunca ha corrido = STALE');
  perform tests.ok(pg_temp.salud() ->> 'mensaje' like '%nunca se han ejecutado%', 'con su mensaje');

  -- ══ 8) Autoridad ══════════════════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  perform tests.ok(public.salud_sistema() ? 'estado', 'Dirección lee la salud');
  perform tests.throws('select count(*) from public.sistema_latidos', 'permission denied', 'ni Dirección lee la tabla directo');
  perform tests.throws('select public.correr_alertas_diarias()', 'permission denied', 'Dirección no ejecuta el job');
  perform tests.throws('select public.avisar_lotes_por_caducar()', 'permission denied', 'ni la función de trabajo');
  perform tests.throws('select count(*) from cron.job_run_details', 'permission denied', 'ni el registro de pg_cron');
  foreach v_o in array array[v_doc, v_wh, v_bill, v_pos] loop
    perform tests.act_as(v_o);
    perform tests.throws('select public.salud_sistema()', 'NO_AUTORIZADO', 'otro rol no lee la salud');
    perform tests.throws('select count(*) from public.sistema_latidos', 'permission denied', 'ni la tabla');
    perform tests.throws('select public.correr_alertas_diarias()', 'permission denied', 'ni corre el job');
  end loop;
  perform tests.act_as_anon();
  perform tests.throws('select public.salud_sistema()', 'permission denied', 'anónimo: nada');
  perform tests.throws('select count(*) from public.sistema_latidos', 'permission denied', 'anónimo: ni la tabla');
  perform tests.throws('select count(*) from cron.job', 'permission denied', 'anónimo: ni cron');
  perform tests.act_as_service();
  perform tests.throws('select public.correr_alertas_diarias()', 'permission denied', 'service_role no ejecuta el envoltorio (no lo necesita)');
  perform tests.act_as_owner();
  perform tests.ok(has_function_privilege('service_role', 'public.avisar_lotes_por_caducar()', 'execute')
               and not has_function_privilege('authenticated', 'public.avisar_lotes_por_caducar()', 'execute'),
    'service_role conserva la función de trabajo (como antes); authenticated no');
  perform tests.ok((select prosecdef from pg_proc where proname = 'salud_sistema') and not (select prosecdef from pg_proc where proname = 'correr_alertas_diarias'),
    'SECURITY DEFINER solo donde hace falta (leer latidos y cron); el envoltorio corre como dueño');
  perform tests.ok((select bool_and(array_to_string(proconfig, ',') like '%search_path=public%') from pg_proc where proname in ('salud_sistema','correr_alertas_diarias','avisar_lotes_por_caducar')),
    'search_path fijo');
  perform tests.ok((select relrowsecurity from pg_class where oid = 'public.sistema_latidos'::regclass) and not exists (select 1 from pg_policy where polrelid = 'public.sistema_latidos'::regclass),
    'sistema_latidos con RLS y sin políticas (nadie entra por RLS)');
end $t$;
rollback;
