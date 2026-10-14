-- CAPTURAR CÉDULA (158) · quien verifica captura o corrige la cédula de un doctor pendiente; queda quién y cuándo.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); sOtro uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); dOk uuid := tests.user('doctor'); r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, sOtro);
  update public.profiles set verified = false where id = d1;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1), (dOk, s1);
  perform tests.cliente(d1);
  perform tests.act_as(s1);
  perform tests.throws(format('select public.doctor_capturar_cedula(%L, %L)', d1, '12-AB'), 'CEDULA_INVALIDA', '1 · solo números');
  r := public.doctor_capturar_cedula(d1, ' 1234 567 ');
  perform tests.eq(r ->> 'cedula', '1234567', '1 · su vendedor la captura (sin espacios)');
  perform tests.act_as_service();
  perform tests.ok((select meta ->> 'cedula' = '1234567' and meta -> 'cedula_capturada' ->> 'por' = s1::text and meta -> 'cedula_capturada' ->> 'rol' = 'vendedor' and not verified from public.profiles where id = d1), '1 · queda quién la capturó; no lo verifica');
  perform tests.ok(exists (select 1 from public.customer_events e join public.customers c on c.id = e.customer_id where c.profile_id = d1 and e.tipo = 'contacto_actualizado'), '1 · queda en la actividad del cliente');
  perform tests.act_as(s1);
  perform tests.eq((public.doctor_capturar_cedula(d1, '1234567') ->> 'idempotente')::boolean, true, '1 · la misma cédula no hace nada');
  perform tests.throws(format('select public.doctor_capturar_cedula(%L, %L)', dOk, '7654321'), 'YA_VERIFICADO', '2 · a un doctor verificado no se le cambia aquí');
  perform tests.act_as(sOtro);
  perform tests.throws(format('select public.doctor_capturar_cedula(%L, %L)', d1, '1111111'), 'NO_AUTORIZADO', '2 · un vendedor que no lo atiende, no');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.doctor_capturar_cedula(%L, %L)', d1, '1111111'), 'NO_AUTORIZADO', '2 · el doctor usa "Mi verificación", no esta vía');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.doctor_capturar_cedula(%L, %L)', d1, '1111111'), 'permission denied', '2 · anónimo no');
  perform tests.act_as(v_admin);
  perform tests.eq(public.doctor_capturar_cedula(d1, '9999999') ->> 'cedula', '9999999', '3 · Dirección también');
  perform tests.act_as_service();
  perform tests.eq((select meta -> 'cedula_capturada' ->> 'anterior' from public.profiles where id = d1), '1234567', '3 · guarda la anterior');
end $t$;
rollback;
