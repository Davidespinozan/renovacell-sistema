-- VERIFICACIÓN POR VENDEDOR (154) · verifica quien atiende al doctor (su vendedor de cartera o el que tiene su
-- conversación) y Dirección; ve su evidencia; aprobar liga su expediente y da acceso; rechazar exige nota.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sSin uuid := tests.user('pos');
  dA uuid := tests.user('doctor', 'pendiente.a@test.local'); dB uuid := tests.user('doctor', 'pendiente.b@test.local'); dC uuid := tests.user('doctor', 'pendiente.c@test.local');
  cuOdoo uuid; conv uuid; r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  update public.profiles set verified = false, meta = coalesce(meta, '{}') || jsonb_build_object('cedula', '1234567', 'verifyResult', jsonb_build_object('decision', 'review', 'raw', 'secreto'),
         'identity', jsonb_build_object('status', 'pending', 'evidence', jsonb_build_object('ine-front', 'identity/' || dA || '/ine-front.jpg')), 'shipping', jsonb_build_object('phone', '6691230000', 'city', 'Mazatlán'))
   where id in (dA, dB, dC);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1);
  insert into public.customers (full_name, email, active, source) values ('Dra. B en Odoo', 'pendiente.b@test.local', true, 'odoo') returning id into cuOdoo;
  conv := (public.cc_abrir_conversacion(null, dB) ->> 'conversation_id')::uuid;
  update public.cc_conversations set seller_profile_id = s2 where id = conv;

  -- ══ 1 · quién puede verificar ══
  perform tests.act_as(s1);  perform tests.ok(public._puede_verificar(dA), '1 · el vendedor de su cartera');
  perform tests.ok(not public._puede_verificar(dB), '1 · no el de otro');
  perform tests.act_as(s2);  perform tests.ok(public._puede_verificar(dB), '1 · el que tiene su conversación asignada');
  perform tests.act_as(sSin); perform tests.ok(not public._puede_verificar(dA) and not public._puede_verificar(dC), '1 · un vendedor que no lo atiende, no');
  perform tests.act_as(v_admin); perform tests.ok(public._puede_verificar(dC), '1 · Dirección siempre');
  perform tests.act_as(dA); perform tests.ok(not public._puede_verificar(dA), '1 · el propio doctor no');

  -- ══ 2 · lo que se revisa (sin datos crudos) y la evidencia ══
  perform tests.act_as(s1);
  r := public.doctor_verificacion_ver(dA);
  perform tests.ok(r ->> 'cedula' = '1234567' and r ->> 'telefono' = '6691230000' and r -> 'sep' ->> 'decision' = 'review' and not (r -> 'sep' ? 'raw') and r -> 'evidencia' ? 'ine-front', '2 · cédula, teléfono, dictamen SEP sin datos crudos y evidencia');
  perform tests.throws(format('select public.doctor_verificacion_ver(%L)', dB), 'NO_AUTORIZADO', '2 · no ve a un doctor que no atiende');

  -- ══ 3 · rechazar exige nota; aprobar da acceso y liga el expediente ══
  perform tests.throws(format('select public.doctor_verificar(%L, false, null)', dA), 'NOTA_REQUERIDA', '3 · rechazar exige nota');
  r := public.doctor_verificar(dA, false, 'La cédula no corresponde al nombre');
  perform tests.eq(r ->> 'estado', 'rejected', '3 · rechazado');
  perform tests.act_as_service();
  perform tests.ok((select not verified and meta -> 'verification' ->> 'status' = 'rejected' and meta -> 'verification' ->> 'reviewed_by' = s1::text from public.profiles where id = dA), '3 · queda rechazado y quién lo revisó');
  perform tests.act_as(s1);
  r := public.doctor_verificar(dA, true, null);
  perform tests.act_as_service();
  perform tests.ok((select verified and meta -> 'verification' ->> 'via' = 'vendedor' from public.profiles where id = dA), '3 · aprobado por su vendedor');
  perform tests.ok(exists (select 1 from public.customers where profile_id = dA and source = 'portal' and phone = '6691230000'), '3 · sin expediente previo: se crea con sus datos');
  perform tests.ok(exists (select 1 from public.customer_events e join public.customers c on c.id = e.customer_id where c.profile_id = dA and e.tipo = 'verificacion_aprobada'), '3 · queda en la actividad');
  perform tests.act_as(s1);
  perform tests.eq((public.doctor_verificar(dA, true, null) ->> 'idempotente')::boolean, true, '3 · aprobar dos veces no hace nada');
  -- con su conversación asignada: liga el expediente de Odoo con su mismo correo y le queda en cartera
  perform tests.act_as(s2);
  r := public.doctor_verificacion_de_conversacion(conv);
  perform tests.eq(r ->> 'profile_id', dB::text, '3 · el panel del chat encuentra al doctor pendiente de esa conversación');
  r := public.doctor_verificar(dB, true, 'Confirmé su cédula por teléfono');
  perform tests.act_as_service();
  perform tests.ok((select profile_id = dB from public.customers where id = cuOdoo), '3 · liga el expediente de Odoo con su mismo correo (no duplica)');
  perform tests.ok((select seller_profile_id = s2 from public.cc_cartera where profile_id = dB), '3 · el vendedor que lo verificó le queda en cartera');
  perform tests.act_as(s2);
  perform tests.eq(public.doctor_verificacion_de_conversacion(conv), null::jsonb, '3 · ya verificado: el panel desaparece');

  -- ══ 4 · nadie más ══
  perform tests.act_as(sSin);
  perform tests.throws(format('select public.doctor_verificar(%L, true, null)', dC), 'NO_AUTORIZADO', '4 · un vendedor que no lo atiende no verifica');
  perform tests.act_as(dC);
  perform tests.throws(format('select public.doctor_verificar(%L, true, null)', dC), 'NO_AUTORIZADO', '4 · el doctor no se verifica solo');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.doctor_verificar(%L, true, null)', dC), 'permission denied', '4 · anónimo tampoco');
  perform tests.act_as(v_admin);
  perform tests.eq((public.doctor_verificar(dC, true, null) ->> 'verificado')::boolean, true, '4 · Dirección verifica a cualquiera');
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public.cc_cartera where profile_id = dC), '4 · si verifica Dirección, no se asigna cartera sola');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_contacto_de(%L)', conv), 'NO_AUTORIZADO', '4 · cc_contacto_de sigue sin mostrar conversaciones ajenas');
end $t$;
rollback;
