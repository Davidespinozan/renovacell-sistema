-- AVISOS PUSH (160) · alta por cuenta o por visitante, un dispositivo = una identidad, baja, destinos y apagado.
begin;
do $t$
declare d1 uuid := tests.user('doctor'); s1 uuid := tests.user('pos'); h text := repeat('7', 63) || 'a'; v uuid; r jsonb; n int; id1 uuid;
begin
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, h, '{}'::jsonb, null); v := public._cc_visitor_por_hash(h);
  r := public.push_suscribir(d1, null, 'https://push.example/a', repeat('k', 87), repeat('s', 22)); id1 := (r ->> 'id')::uuid;
  perform public.push_suscribir(null, h, 'https://push.example/b', repeat('k', 87), repeat('s', 22));
  perform tests.throws(format('select public.push_suscribir(null, %L, %L, %L, %L)', repeat('0', 64), 'https://push.example/c', repeat('k', 87), repeat('s', 22)), 'SESION_INVALIDA', '1 · visitante desconocido no se suscribe');
  perform tests.throws(format('select public.push_suscribir(%L, null, %L, %L, %L)', d1, 'http://inseguro/x', repeat('k', 87), repeat('s', 22)), 'check constraint', '1 · solo direcciones https');
  select count(*) into n from public.push_destinos(array[d1], array[v]); perform tests.eq(n, 2, '2 · destinos de la cuenta y del visitante');
  select count(*) into n from public.push_destinos(array[s1], null); perform tests.eq(n, 0, '2 · nadie más');
  perform public.push_suscribir(s1, null, 'https://push.example/a', repeat('k', 87), repeat('s', 22));
  perform tests.ok((select profile_id = s1 from public.push_suscripciones where endpoint = 'https://push.example/a'), '3 · el mismo dispositivo con otra cuenta: pasa a la actual');
  select count(*) into n from public.push_destinos(array[d1], null); perform tests.eq(n, 0, '3 · la cuenta anterior ya no recibe en ese dispositivo');
  perform public.push_resultado(id1, false, true);
  perform tests.ok((select not activo from public.push_suscripciones where id = id1), '4 · si el servicio dice que ya no existe, se apaga');
  perform public.push_suscribir(s1, null, 'https://push.example/a', repeat('k', 87), repeat('s', 22));
  perform tests.ok((select activo and fallos = 0 from public.push_suscripciones where id = id1), '4 · volver a activarlos lo enciende');
  perform public.push_baja('https://push.example/b');
  select count(*) into n from public.push_destinos(null, array[v]); perform tests.eq(n, 0, '5 · baja del dispositivo');
  perform tests.act_as(d1);
  perform tests.throws('select count(*) from public.push_suscripciones', 'permission denied', '6 · la tabla no se lee con sesión');
  perform tests.throws(format('select public.push_suscribir(%L, null, %L, %L, %L)', d1, 'https://push.example/z', repeat('k', 87), repeat('s', 22)), 'permission denied', '6 · ni se suscribe directo');
  perform tests.act_as_anon();
  perform tests.throws('select * from public.push_destinos(null, null)', 'permission denied', '6 · anónimo nada');
end $t$;
rollback;
