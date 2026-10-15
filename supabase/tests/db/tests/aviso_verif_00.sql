-- AVISO DE VERIFICACIÓN (163) · al mandar su verificación, el doctor llega a SU vendedora (cartera, su conversación o la
-- del enlace con la que se registró); sin vendedora, a Dirección. La vendedora ve su lista de "por verificar".
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); s3 uuid := tests.user('pos');
  dA uuid; dB uuid; dC uuid; dV uuid; h text := repeat('7', 63) || 'a'; c uuid; r jsonb; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2, s3);
  dA := tests.user('doctor', 'avA@t.local'); dB := tests.user('doctor', 'avB@t.local'); dC := tests.user('doctor', 'avC@t.local'); dV := tests.user('doctor', 'avV@t.local');
  update public.profiles set verified = false, meta = coalesce(meta, '{}') || '{"cedula":"1234567","verification":{"status":"pending"}}' where id in (dA, dB, dC);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1);
  -- dB se registró desde el enlace: su visitante quedó ligado y su conversación la atiende s2
  perform public.cc_visitante_abrir(null, h, '{}'::jsonb, null);
  perform public.cc_visitante_prerregistrar(h, 'Dra. Enlace', '6690000301', 'avB@t.local', true, null, true);
  c := (public.cc_abrir_conversacion(h, null) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner(); update public.cc_conversations set seller_profile_id = s2 where id = c;
  perform tests.act_as_service(); perform public.cc_visitante_vincular_registro(h, dB);

  r := public.verificacion_avisar(dA);
  perform tests.ok((r ->> 'seller')::uuid = s1 and not (r ->> 'asignado')::boolean, '1 · con cartera: avisa a su vendedora');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'verificacion_por_revisar' and s1 = any(user_ids) and screen = 'clientes'), '1 · el aviso la lleva a Clientes');
  r := public.verificacion_avisar(dB);
  perform tests.ok((r ->> 'seller')::uuid = s2 and (r ->> 'asignado')::boolean and (select seller_profile_id = s2 from public.cc_cartera where profile_id = dB), '2 · registrado por el enlace: avisa a quien lo atendía y queda en su cartera');
  r := public.verificacion_avisar(dC);
  perform tests.ok(r ->> 'seller' is null and exists (select 1 from public.notifications where 'admin' = any(roles) and kind = 'verificacion_por_revisar' and body like '%sin vendedora%')
    and not exists (select 1 from public.cc_cartera where profile_id = dC), '3 · sin vendedora: avisa a Dirección y no inventa cartera');
  perform tests.ok(not (public.verificacion_avisar(dV) ->> 'avisado')::boolean, '4 · ya verificado: no avisa');
  select count(*) into n from public.notifications where kind = 'verificacion_por_revisar' and s1 = any(user_ids);
  perform public.verificacion_avisar(dA);
  perform tests.ok((select count(*) from public.notifications where kind = 'verificacion_por_revisar' and s1 = any(user_ids)) = n, '4 · un doble envío en el mismo minuto no duplica');

  perform tests.act_as(s1); perform tests.throws(format('select public.verificacion_avisar(%L)', dA), 'permission denied', '5 · nadie la llama directo');
  perform tests.ok((select jsonb_agg(e ->> 'profile_id') from jsonb_array_elements(public.mis_por_verificar()) e) = jsonb_build_array(dA::text), '6 · la vendedora ve SUS doctores por verificar');
  perform tests.act_as(s2); perform tests.ok(jsonb_array_length(public.mis_por_verificar()) = 1, '6 · s2 ve al que le llegó por el enlace');
  perform tests.act_as(s3); perform tests.ok(jsonb_array_length(public.mis_por_verificar()) = 0, '6 · otra vendedora no ve ninguno');
  perform tests.act_as(v_admin); perform tests.ok(jsonb_array_length(public.mis_por_verificar()) >= 3, '6 · Dirección ve todos');
  perform tests.act_as(dA); perform tests.throws('select public.mis_por_verificar()', 'NO_AUTORIZADO', '6 · un doctor no');
end $t$;
rollback;
