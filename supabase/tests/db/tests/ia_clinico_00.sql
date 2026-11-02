-- IA CLÍNICA (20270227) · cc_ia_contexto_actor dice `clinico` solo cuando ese actor ya puede ver las secciones T2:
-- doctor verificado o personal, y Dirección con T2 habilitado. Visitante, doctor sin verificar y suspendido, nunca.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  perform tests.act_as_owner();
  update public.cc_knowledge_config set t2_habilitado = false where id = 'default';
  perform tests.act_as_service();
  perform tests.ok(not (public.cc_ia_contexto_actor(v_doc) ->> 'clinico')::boolean, '1 · T2 apagado: ni el verificado tiene clínico');

  perform tests.act_as_owner(); update public.cc_knowledge_config set t2_habilitado = true where id = 'default'; perform tests.act_as_service();
  r := public.cc_ia_contexto_actor(v_doc);
  perform tests.ok((r ->> 'clinico')::boolean and r ->> 'audiencia' = 'verified' and (r ->> 'puede_precio')::boolean, '2 · T2 encendido: doctor verificado con clínico (el resto igual)');
  perform tests.ok((public.cc_ia_contexto_actor(v_admin) ->> 'clinico')::boolean, '3 · Dirección (staff) también');
  perform tests.ok(not (public.cc_ia_contexto_actor(v_nov) ->> 'clinico')::boolean, '4 · doctor sin verificar: sin clínico');
  perform tests.ok(not (public.cc_ia_contexto_actor(null) ->> 'clinico')::boolean, '5 · visitante: sin clínico');
  perform tests.ok(not (public.cc_ia_contexto_actor(gen_random_uuid()) ->> 'clinico')::boolean, '6 · perfil inexistente: sin clínico');
end $t$;
rollback;
