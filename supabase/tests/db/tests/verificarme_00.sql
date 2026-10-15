-- VERIFICARME (159) · el servidor lee los datos del prerregistro de ESE visitante y de nadie más.
begin;
do $t$
declare hA text := repeat('5', 63) || 'e'; hB text := repeat('6', 63) || 'f'; d1 uuid := tests.user('doctor'); r jsonb;
begin
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null);
  perform public.cc_visitante_prerregistrar(hA, 'Dra. Chat', '6691110022', 'chat@test.local', true, '1234567', true);
  r := public.cc_prerregistro_datos(hA);
  perform tests.ok(r ->> 'nombre' = 'Dra. Chat' and r ->> 'email' = 'chat@test.local' and r ->> 'telefono' = '6691110022' and r ->> 'cedula' = '1234567' and r ->> 'consent_at' is not null, '1 · sus datos del prerregistro');
  perform tests.eq(public.cc_prerregistro_datos(hB), null::jsonb, '1 · sin prerregistro: nada');
  perform tests.eq(public.cc_prerregistro_datos(repeat('0', 64)), null::jsonb, '1 · token desconocido: nada');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_prerregistro_datos(%L)', hA), 'permission denied', '2 · una sesión no los lee');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_prerregistro_datos(%L)', hA), 'permission denied', '2 · anónimo tampoco');
end $t$;
rollback;
