-- CORREOS AUTOMÁTICOS (165) · salen solos cada minuto (solo si hay pendientes y con secreto), correos de la cuenta del
-- doctor una vez por hecho, y la venta de mostrador no anuncia "te avisaremos cuando salga".
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d uuid; d2 uuid; v_caj uuid := tests.user('pos'); o uuid; n int; r text;
begin
  -- 1 · cuenta
  perform tests.act_as_service();
  d := tests.user('doctor', 'correos-auto@t.local');
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.profiles set verified = false, meta = coalesce(meta, '{}') || '{"capturedVia":"auto-registro","verification":{"status":"pending"}}' where id = d;
  perform tests.ok(exists (select 1 from public.comm_outbox where event_key = 'registro_recibido:' || d and status = 'pendiente' and to_address = 'correos-auto@t.local'), '1 · al entrar a revisión: "recibimos tu registro"');
  update public.profiles set meta = meta || '{"cedula":"1234567"}' where id = d;
  update public.profiles set meta = meta || '{"verification":{"status":"rejected","reason":"La foto del INE no se lee"}}' where id = d;
  perform tests.ok((select count(*) from public.comm_outbox where event_key = 'registro_recibido:' || d) = 1, '1 · otros cambios no lo repiten');
  perform tests.ok(exists (select 1 from public.comm_outbox where plantilla = 'verificacion_rechazada' and profile_id = d and payload ->> 'motivo' = 'La foto del INE no se lee'), '2 · rechazo: correo con el motivo');
  update public.profiles set meta = meta || '{"verification":{"status":"pending"}}' where id = d;
  update public.profiles set verified = true, meta = meta || '{"verification":{"status":"verified"}}' where id = d;
  perform tests.ok((select count(*) from public.comm_outbox where event_key = 'cuenta_verificada:' || d) = 1 and (select count(*) from public.comm_outbox where event_key = 'registro_recibido:' || d) = 1, '3 · aprobado: "tu cuenta está verificada" (y el registro no se repite al corregir)');
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as_service(); d2 := tests.user('pos', 'cajero2@t.local');
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.comm_outbox where profile_id = d2), '4 · el personal no recibe correos de cuenta de doctor');
  d2 := tests.user('doctor', 'alta-personal@t.local');
  perform set_config('app.trusted', 'on', true);
  update public.profiles set verified = false, meta = coalesce(meta, '{}') || '{"verification":{"status":"pending"}}' where id = d2;
  perform set_config('app.trusted', 'off', true);
  perform tests.ok(not exists (select 1 from public.comm_outbox where profile_id = d2), '4 · un alta del personal no recibe "recibimos tu registro"');

  -- 5 · mostrador: venta POS pagada no manda "pago recibido"
  perform tests.act_as_owner(); o := tests.venta_pos(v_caj, 500);
  perform tests.ok(not exists (select 1 from public.comm_outbox where order_id = o and plantilla = 'pago_recibido'), '5 · venta de mostrador: sin "te avisaremos cuando salga"');

  -- 6 · envío automático
  perform tests.ok(exists (select 1 from cron.job where jobname = 'renovacell-correos' and schedule = '* * * * *' and command = 'select public._correos_despachar()'), '6 · tarea cada minuto');
  delete from net._llamadas;
  perform tests.eq(public._correos_despachar(), 'sin_configurar', '6 · sin secreto en vault: no llama a nadie');
  insert into vault.decrypted_secrets values ('project_url', 'https://x.supabase.co/'), ('comm_cron_secret', 's3cr3t');
  perform tests.eq(public._correos_despachar(), 'despachado', '6 · con pendientes y secreto: despierta a comm-dispatch');
  perform tests.ok((select url = 'https://x.supabase.co/functions/v1/comm-dispatch' and headers ->> 'x-cron-secret' = 's3cr3t' from net._llamadas order by id desc limit 1), '6 · con su secreto, a la URL correcta');
  perform set_config('app.trusted', 'on', true);
  update public.comm_outbox set status = 'fallido', last_error = 'prueba' where status = 'pendiente';
  perform set_config('app.trusted', 'off', true);
  perform tests.eq(public._correos_despachar(), 'sin_pendientes', '6 · sin pendientes no llama (no gasta)');
  perform tests.act_as(v_admin);
  perform tests.throws('select public._correos_despachar()', 'permission denied', '7 · nadie la llama directo');
end $t$;
rollback;
