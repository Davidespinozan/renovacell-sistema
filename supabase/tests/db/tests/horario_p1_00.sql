-- HORARIO-P1 (132) · con safeupdate cargado como en producción (rol authenticator): sin la corrección, «Guardar
-- horario» falla con "DELETE requires a WHERE clause" y no escribe nada; con ella, Dirección guarda L–S 10:00–18:00 y
-- domingo cerrado en America/Mazatlan, idempotente y auditado, y el estado de horario/handoff/SLA lo refleja.
-- safeupdate: si SAFEUPDATE_LIB apunta a la biblioteca compilada (pg-safeupdate), se carga como en producción;
-- sin ella, las pruebas funcionales corren igual y la guarda estática (13) sigue vigilando DELETE/UPDATE sin WHERE.
\getenv safeupdate_lib SAFEUPDATE_LIB
begin;
\if :{?safeupdate_lib}
load :'safeupdate_lib';
select set_config('tests.safeupdate_esperado', 'on', true);
\endif
do $t$
declare
  v_admin uuid := tests.fixture_admin(); vS uuid := tests.user('pos'); vD uuid := tests.user('doctor');
  semana jsonb; r jsonb; fijo boolean; e jsonb; n int;
  lunes date := date '2026-10-12'; domingo date := date '2026-10-11';   -- lunes y domingo (calendario fijo)
begin
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', g <= 6, 'abre', case when g <= 6 then '10:00' end, 'cierra', case when g <= 6 then '18:00' end) order by g) from generate_series(1, 7) g);
  fijo := position('where dia between 1 and 7' in pg_get_functiondef('public.cc_horario_guardar(text,jsonb)'::regprocedure)) > 0;
  perform tests.act_as(v_admin);
  perform tests.ok(fijo, '0 · cc_horario_guardar trae la corrección HORARIO-P1');
  if current_setting('tests.safeupdate_esperado', true) = 'on' then
    perform tests.ok(current_setting('safeupdate.enabled', true) is not null, '0 · safeupdate cargado como en producción');
  end if;

  -- ══ 1 · Dirección guarda L–S 10:00–18:00, domingo cerrado, America/Mazatlan; lectura posterior consistente ══
  r := public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.eq((r ->> 'configurado')::boolean, true, '1 · configurado');
  perform tests.eq(r ->> 'zona', 'America/Mazatlan', '1 · zona');
  perform tests.eq(r -> 'semana' -> 0, '{"dia": 1, "abre": "10:00", "cierra": "18:00", "abierto": true}'::jsonb, '1 · lunes 10:00–18:00');
  perform tests.eq(r -> 'semana' -> 5, '{"dia": 6, "abre": "10:00", "cierra": "18:00", "abierto": true}'::jsonb, '1 · sábado 10:00–18:00');
  perform tests.eq(r -> 'semana' -> 6, '{"dia": 7, "abre": null, "cierra": null, "abierto": false}'::jsonb, '1 · domingo cerrado');
  perform tests.eq(public.cc_horario_ver() -> 'semana', r -> 'semana', '1 · releer = lo guardado (persistencia)');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.cc_horario_eventos where accion = 'semana_guardada'), 1, '1 · auditado (1 evento)');
  perform tests.eq((select count(*)::int from public.cc_horario_semanal), 7, '1 · 7 días');

  -- ══ 2 · doble guardado: mismo resultado, sin duplicados (cada guardado queda auditado) ══
  perform tests.act_as(v_admin);
  r := public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.eq(r -> 'semana', public.cc_horario_ver() -> 'semana', '2 · segundo guardado idéntico');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.cc_horario_semanal), 7, '2 · sigue con 7 días (sin duplicados)');
  perform tests.eq((select count(*)::int from public.cc_horario_eventos), 2, '2 · los dos guardados auditados');

  -- ══ 3 · permisos: vendedor, doctor y anónimo rechazados; nada cambia ══
  perform tests.act_as(vS);
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', semana), 'NO_AUTORIZADO', '3 · vendedor no modifica');
  perform tests.act_as(vD);
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', semana), 'NO_AUTORIZADO', '3 · doctor no modifica');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', semana), 'permission denied', '3 · anónimo sin EXECUTE');

  -- ══ 4 · validaciones del servidor (con safeupdate) y atomicidad ══
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'Luna/Base', semana), 'ZONA_INVALIDA', '4 · zona inválida');
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', '[]'), 'SEMANA_INVALIDA', '4 · semana incompleta');
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', jsonb_set(semana, '{0,cierra}', '"09:00"')), 'HORARIO_INVALIDO', '4 · apertura después del cierre');
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', jsonb_set(semana, '{1,dia}', '1')), 'SEMANA_INVALIDA', '4 · día repetido');
  perform tests.eq(public.cc_horario_ver() -> 'semana' -> 0 ->> 'cierra', '18:00', '4 · un guardado inválido no deja la semana a medias');

  -- ══ 5 · estado: dentro/fuera de horario en America/Mazatlan; [abre, cierra) ══
  perform tests.act_as_service();
  perform tests.eq((public._cc_horario_estado((lunes + time '10:00') at time zone 'America/Mazatlan') ->> 'abierto')::boolean, true, '5 · lunes 10:00 abierto');
  perform tests.eq((public._cc_horario_estado((lunes + time '17:59') at time zone 'America/Mazatlan') ->> 'abierto')::boolean, true, '5 · lunes 17:59 abierto');
  perform tests.eq((public._cc_horario_estado((lunes + time '18:00') at time zone 'America/Mazatlan') ->> 'abierto')::boolean, false, '5 · lunes 18:00 cerrado');
  perform tests.eq((public._cc_horario_estado((lunes + time '09:59') at time zone 'America/Mazatlan') ->> 'abierto')::boolean, false, '5 · lunes 09:59 cerrado');
  e := public._cc_horario_estado((domingo + time '12:00') at time zone 'America/Mazatlan');
  perform tests.eq((e ->> 'abierto')::boolean, false, '5 · domingo cerrado');
  perform tests.eq((e ->> 'proxima_apertura')::timestamptz, (lunes + time '10:00') at time zone 'America/Mazatlan', '5 · próxima apertura: lunes 10:00');

  -- ══ 6 · textos del handoff y SLA en minutos hábiles ══
  perform tests.ok(public._cc_texto_handoff(true, true) like 'Te conectaremos%', '6 · en horario: "Te conectaremos…"');
  perform tests.ok(public._cc_texto_handoff(true, false) <> public._cc_texto_handoff(false, false), '6 · fuera de horario ≠ sin configurar');
  perform tests.eq(public._cc_minutos_habiles((lunes + time '09:00') at time zone 'America/Mazatlan', (lunes + time '11:00') at time zone 'America/Mazatlan'), 60, '6 · SLA: 09:00→11:00 = 60 min hábiles');
  perform tests.eq(public._cc_minutos_habiles((domingo + time '09:00') at time zone 'America/Mazatlan', (domingo + time '20:00') at time zone 'America/Mazatlan'), 0, '6 · SLA: domingo no cuenta');

  -- ══ 13 · guarda estática: ninguna función de public con DELETE/UPDATE sin WHERE (safeupdate los rechaza vía API) ══
  perform tests.eq((select count(*)::int from (
      select (regexp_matches(pg_get_functiondef(p.oid), '(delete\s+from\s+[a-z_."]+[^;]*;|update\s+[a-z_."]+\s+set\s[^;]*;)', 'gi'))[1] s
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f') x
     where s !~* '\mwhere\M'), 0, '13 · sin DELETE/UPDATE sin WHERE en funciones de public');
end $t$;
rollback;
