-- CC-0B · Limitador de tasa: atómico, por ventana fija, por (scope, subject); solo el
-- servidor lo invoca; nunca cuenta de más ni de menos; limpieza acotada; costo de la
-- operación medido.
begin;
do $t$
declare
  v_doc uuid := tests.user('doctor'); v_admin uuid := tests.fixture_admin();
  r jsonb; i int; t0 timestamptz; t1 timestamptz; ms numeric; n int;
begin
  -- ══ privilegios: solo service_role ═══════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select public.rate_limit_hit(''x'', ''y'', 5, 60)', 'permission denied', 'ANON no ejecuta rate_limit_hit');
  perform tests.throws('select count(*) from public.rate_limit_buckets', 'permission denied', 'ANON no lee los cubos');
  perform tests.act_as(v_doc);
  perform tests.throws('select public.rate_limit_hit(''x'', ''y'', 5, 60)', 'permission denied', 'DOCTOR no ejecuta rate_limit_hit');
  perform tests.throws('select count(*) from public.rate_limit_buckets', 'permission denied', 'DOCTOR no lee los cubos');
  perform tests.act_as(v_admin);
  perform tests.throws('select public.rate_limit_hit(''x'', ''y'', 5, 60)', 'permission denied', 'ADMIN tampoco (es autoridad del servidor, no de Dirección)');
  perform tests.act_as_service();
  perform tests.lives('select public.rate_limit_hit(''x'', ''y'', 5, 60)', 'SERVICE_ROLE ejecuta rate_limit_hit');

  -- ══ semántica: cuenta y veredicto ════════════════════════════════════════
  for i in 1..5 loop r := public.rate_limit_hit('s1', 'ip:a', 5, 3600); end loop;
  perform tests.eq((r ->> 'allowed')::boolean, true, '5 de 5: permitido');
  perform tests.eq((r ->> 'count')::int, 5, 'count = 5');
  perform tests.eq((r ->> 'remaining')::int, 0, 'remaining = 0');
  r := public.rate_limit_hit('s1', 'ip:a', 5, 3600);
  perform tests.eq((r ->> 'allowed')::boolean, false, '6 de 5: limitado');
  perform tests.eq((r ->> 'count')::int, 6, 'el que insiste sigue contando (no resetea)');
  perform tests.ok((r ->> 'retry_after_secs')::int between 1 and 3600, 'retry_after dentro de la ventana');
  perform tests.ok((r ->> 'reset_at')::timestamptz > now() and (r ->> 'reset_at')::timestamptz <= now() + interval '1 hour', 'reset_at = fin de la ventana');
  -- C · sujetos y scopes distintos no comparten cubo
  r := public.rate_limit_hit('s1', 'ip:b', 5, 3600);
  perform tests.eq((r ->> 'count')::int, 1, 'C · otro sujeto arranca en 1');
  r := public.rate_limit_hit('s2', 'ip:a', 5, 3600);
  perform tests.eq((r ->> 'count')::int, 1, 'C · otro scope arranca en 1');
  -- costo variable y ajuste negativo (tokens estimados → reales)
  r := public.rate_limit_hit('tok', 'global', 1000, 86400, 600);
  perform tests.eq((r ->> 'count')::int, 600, 'costo 600 pre-cargado');
  r := public.rate_limit_hit('tok', 'global', 1000, 86400, -200);
  perform tests.eq((r ->> 'count')::int, 400, 'ajuste negativo: 600 − 200 = 400');
  r := public.rate_limit_hit('tok', 'global', 1000, 86400, 700);
  perform tests.eq((r ->> 'allowed')::boolean, false, 'B · techo diario agotado (1100 > 1000): no permitido');
  r := public.rate_limit_hit('tok', 'global', 1000, 86400, -5000);
  perform tests.eq((r ->> 'count')::int, 0, 'nunca queda negativo');
  r := public.rate_limit_hit('tok2', 'global', 10, 60, -3);
  perform tests.eq((r ->> 'count')::int, 0, 'ajuste negativo sobre ventana nueva: 0');
  -- argumentos inválidos: error controlado (no SQL interno)
  perform tests.throws('select public.rate_limit_hit(''s'', ''x'', 0, 60)', 'RL_ARGUMENTOS', 'límite 0 rechazado');
  perform tests.throws('select public.rate_limit_hit(''s'', ''x'', 5, 0)', 'RL_ARGUMENTOS', 'ventana 0 rechazada');
  perform tests.throws('select public.rate_limit_hit(''s'', ''x'', 5, 999999999)', 'RL_ARGUMENTOS', 'ventana > 7 días rechazada');
  perform tests.throws('select public.rate_limit_hit(repeat(''a'', 81), ''x'', 5, 60)', 'RL_ARGUMENTOS', 'scope largo rechazado');
  perform tests.throws('select public.rate_limit_hit(''s'', null, 5, 60)', 'RL_ARGUMENTOS', 'subject nulo rechazado');
  perform tests.throws('select public.rate_limit_hit(''s'', ''x'', 5, 60, 10000000)', 'RL_ARGUMENTOS', 'costo absurdo rechazado');

  -- ══ ventanas: dos ventanas distintas son dos cubos; limpieza acotada ═════
  perform tests.act_as_owner();
  insert into public.rate_limit_buckets (scope, subject, window_start, count) values
    ('viejo', 'ip:z', now() - interval '1 minute', 99),     -- dentro de 2 ventanas de 60 s: se conserva
    ('viejo', 'ip:z', now() - interval '3 hours', 99),      -- > 2 ventanas de 60 s: se retira
    ('otro',  'ip:z', now() - interval '3 hours', 99);      -- otro scope: NO se toca
  perform tests.act_as_service();
  r := public.rate_limit_hit('viejo', 'ip:nuevo', 5, 60);
  perform tests.act_as_owner();
  select count(*) into n from public.rate_limit_buckets where scope = 'viejo';
  perform tests.eq(n, 2, 'limpieza: el cubo viejo del scope se retiró, el reciente y el nuevo quedan');
  perform tests.eq((select count(*)::int from public.rate_limit_buckets where scope = 'otro'), 1, 'limpieza: nunca toca otro scope');

  -- ══ rendimiento (orientativo; falla solo si es absurdo) ═══════════════════
  perform tests.act_as_service();
  t0 := clock_timestamp();
  for i in 1..2000 loop r := public.rate_limit_hit('perf', 'ip:fijo', 1000000, 3600); end loop;
  t1 := clock_timestamp(); ms := extract(epoch from (t1 - t0)) * 1000 / 2000;
  raise notice 'PERF cubo existente: % ms/op', round(ms, 3);
  perform tests.ok(ms < 20, 'cubo existente: < 20 ms/op (medido ' || round(ms, 3) || ')');
  t0 := clock_timestamp();
  for i in 1..500 loop r := public.rate_limit_hit('perf', 'ip:' || i::text, 1000000, 3600); end loop;
  t1 := clock_timestamp(); ms := extract(epoch from (t1 - t0)) * 1000 / 500;
  raise notice 'PERF cubo nuevo: % ms/op', round(ms, 3);
  perform tests.ok(ms < 20, 'cubo nuevo: < 20 ms/op (medido ' || round(ms, 3) || ')');
  perform tests.act_as_owner();
end $t$;
rollback;
