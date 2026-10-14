-- MI VERIFICACIÓN (155) · el doctor ve su estado (y qué le falta); al rechazarlo ve el motivo; al aprobarlo o
-- rechazarlo recibe aviso. Solo lo suyo.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  update public.profiles set verified = false, meta = coalesce(meta, '{}') || jsonb_build_object('identity', jsonb_build_object('evidence', jsonb_build_object('ine-front', 'identity/' || d1 || '/ine-front.jpg'))) where id in (d1, d2);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);

  perform tests.act_as(d1);
  r := public.mi_verificacion();
  perform tests.eq(r ->> 'estado', 'pending', '1 · pendiente');
  perform tests.eq(r -> 'faltan', '["cedula", "ine-back"]'::jsonb, '1 · le dice qué le falta (cédula e INE reverso)');
  perform tests.act_as(s1);
  perform tests.throws('select public.mi_verificacion()', 'NO_AUTORIZADO', '1 · solo doctores');
  perform tests.act_as_anon();
  perform tests.throws('select public.mi_verificacion()', 'permission denied', '1 · anónimo no');

  perform tests.act_as(s1);
  perform public.doctor_verificar(d1, false, 'Falta el reverso del INE');
  perform tests.act_as(d1);
  r := public.mi_verificacion();
  perform tests.ok(r ->> 'estado' = 'rejected' and r ->> 'motivo' = 'Falta el reverso del INE', '2 · rechazado: ve el motivo');
  perform tests.act_as_service();
  perform tests.ok((select meta -> 'verification' ? 'reason' and not (meta -> 'verification' ? 'nota') from public.profiles where id = d1), '2 · el motivo usa la misma clave que Dirección (reason)');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'verificacion_rechazada' and user_ids = array[d1] and screen = 'mi_verificacion' and body like '%Falta el reverso del INE%'), '2 · recibe aviso con el motivo');

  perform tests.act_as(s1);
  perform public.doctor_verificar(d1, true, null);
  perform tests.act_as(d1);
  r := public.mi_verificacion();
  perform tests.ok(r ->> 'estado' = 'verified' and (r ->> 'verificado')::boolean and r ->> 'motivo' is null, '3 · aprobado: verificado, sin motivo viejo');
  perform tests.act_as_service();
  perform tests.ok(exists (select 1 from public.notifications where kind = 'verificacion_aprobada' and user_ids = array[d1]), '3 · recibe aviso de aprobación');
  perform tests.act_as(d2);
  perform tests.eq(public.mi_verificacion() ->> 'estado', 'pending', '4 · cada doctor ve solo lo suyo');
end $t$;
rollback;
