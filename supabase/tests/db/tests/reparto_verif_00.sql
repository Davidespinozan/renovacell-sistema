-- REPARTO-VERIF (20270213) · un doctor sin vendedor que manda su verificación le toca AL AZAR a un vendedor que recibe
-- clientes nuevos (nunca a Dirección ni a una cuenta interna); ese vendedor lo puede verificar y al hacerlo se queda con la
-- cartera; si en 4 h hábiles no lo hace, pasa a otro; agotados, nueva vuelta. Con vendedor, como antes.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sInt uuid := tests.user('pos'); sNo uuid := tests.user('pos');
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); d3 uuid := tests.user('doctor');
  r jsonb; v1 uuid; v2 uuid; v3 uuid; otro uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2, sInt);
  update public.profiles set interna = true where id = sInt;
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = sNo;   -- atiende, no recibe nuevos
  update public.profiles set verified = false, full_name = 'Dra. Sin Vendedor', meta = coalesce(meta, '{}') || '{"verification":{"status":"pending"}}' where id in (d1, d2, d3);
  update public.cc_atencion_config set pausar_fuera_horario = false where id = 1;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d2, sNo);

  -- ══ 1 · sin vendedor → al azar, a un vendedor que recibe nuevos; nada a Dirección ══
  r := public.verificacion_avisar(d1);
  v1 := (r ->> 'seller')::uuid;
  perform tests.ok(v1 in (s1, s2) and (r ->> 'reparto')::boolean, '1 · le tocó a un vendedor al azar (nunca a la interna ni a quien no recibe nuevos)');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'verificacion_por_revisar' and user_ids = array[v1] and body like 'Te tocó verificar a Dra. Sin Vendedor%' and screen = 'clientes'), '1 · el aviso le llega a él');
  perform tests.ok(not exists (select 1 from public.notifications where kind = 'verificacion_por_revisar' and roles = array['admin']), '1 · nada a Dirección');
  perform tests.ok(not exists (select 1 from public.cc_cartera where profile_id = d1), '1 · la cartera se fija hasta que lo verifique');
  otro := case when v1 = s1 then s2 else s1 end;
  perform tests.act_as(v1);
  perform tests.ok(public._puede_verificar(d1), '1 · ese vendedor lo puede verificar');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.mis_por_verificar()) x where x ->> 'profile_id' = d1::text), '1 · y lo ve en sus Por verificar');
  perform tests.act_as(otro);
  perform tests.ok(not public._puede_verificar(d1), '1 · otro vendedor no');

  -- ══ 2 · reenvía (corrigió): sigue con el mismo vendedor ══
  perform tests.act_as_service();
  perform tests.eq((public.verificacion_avisar(d1) ->> 'seller')::uuid, v1, '2 · al reenviar sigue con el mismo');

  -- ══ 3 · 4 h hábiles sin verificarlo → pasa al otro; luego, nueva vuelta ══
  r := public.cc_verif_reparto_evaluar();
  perform tests.eq((r ->> 'rotados')::int, 0, '3 · antes del plazo no rota');
  update public.cc_verif_reparto set asignado_at = now() - interval '241 minutes' where profile_id = d1;
  r := public.cc_verif_reparto_evaluar();
  select seller_profile_id into v2 from public.cc_verif_reparto where profile_id = d1;
  perform tests.ok((r ->> 'rotados')::int = 1 and v2 = otro, '3 · vencido: pasa al otro vendedor');
  perform tests.ok(exists (select 1 from public.notifications where user_ids = array[otro] and body like 'Te tocó verificar%'), '3 · y le avisa');
  update public.cc_verif_reparto set asignado_at = now() - interval '241 minutes' where profile_id = d1;
  perform public.cc_verif_reparto_evaluar();
  select seller_profile_id into v3 from public.cc_verif_reparto where profile_id = d1;
  perform tests.ok(v3 = v1 and (select vueltas = 1 from public.cc_verif_reparto where profile_id = d1), '3 · ya pasó por todos: nueva vuelta (sin repetir al último)');

  -- ══ 4 · el vendedor lo verifica: se queda con la cartera y sale del reparto ══
  perform tests.act_as(v3);
  perform public.doctor_verificar(d1, true, null);
  perform tests.act_as_service();
  perform tests.ok((select seller_profile_id = v3 from public.cc_cartera where profile_id = d1), '4 · cartera para quien lo verificó');
  perform public.cc_verif_reparto_evaluar();
  perform tests.ok(not exists (select 1 from public.cc_verif_reparto where profile_id = d1), '4 · sale del reparto');

  -- ══ 5 · con vendedor de cartera: como antes, sin reparto ══
  r := public.verificacion_avisar(d2);
  perform tests.ok((r ->> 'seller')::uuid = sNo and not (r ->> 'reparto')::boolean and not exists (select 1 from public.cc_verif_reparto where profile_id = d2), '5 · con vendedor: le llega a su vendedor');

  -- ══ 6 · sin NINGÚN vendedor que reciba nuevos: entonces Dirección se entera ══
  update public.profiles set meta = meta - 'capabilities' where id in (s1, s2, sInt);
  r := public.verificacion_avisar(d3);
  perform tests.ok(r -> 'seller' = 'null'::jsonb and exists (select 1 from public.notifications where roles = array['admin'] and body like '%no hay vendedores que reciban clientes nuevos'), '6 · sin vendedores: aviso a Dirección');

  -- ══ 7 · permisos ══
  perform tests.act_as(s1);
  perform tests.throws('select public.cc_verif_reparto_evaluar()', 'NO_AUTORIZADO', '7 · un vendedor no corre el evaluador');
  perform tests.throws('select count(*) from public.cc_verif_reparto', 'permission denied', '7 · ni lee la tabla');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from cron.job where jobname = 'renovacell-verif-reparto' and schedule = '*/5 * * * *' and active) = 1, '7 · cron cada 5 minutos');
end $t$;
rollback;
