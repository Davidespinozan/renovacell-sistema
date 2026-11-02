-- WA VÍNCULO (20270302) · el doctor conecta SU WhatsApp con un código pedido desde su sesión; la IA de esa conversación lo
-- reconoce. Coincidir teléfono sigue sin probar nada (R4-B1); un código vencido, usado o de otro no liga; la conversación de
-- WhatsApp no se fusiona con la del portal. Dirección puede vincular o quitar a mano.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); dn uuid := tests.user('doctor'); s1 uuid := tests.user('pos');
  r jsonb; v_conv uuid; v_conv2 uuid; v_cod text; ok boolean; t text;
begin
  perform tests.act_as_service(); update public.profiles set verified = false where id = dn;
  update public.profiles set meta = coalesce(meta, '{}') || '{"phone":"6679990001"}' where id = d2;   -- d2 escribió en su perfil el número de otro

  -- WhatsApp de d1 entra como visitante interno (aunque el teléfono coincida con el perfil de d2)
  r := public.cc_wa_entrante('5216679990001', 'Ana', 'wamid.VI.1', 'Hola', false); v_conv := (r ->> 'conversation_id')::uuid;
  perform tests.ok(r ->> 'actor' = 'visitor' and public.cc_ia_identidad_canal(v_conv) is null, '0 · sin vínculo: visitante y la IA no reconoce a nadie (R4-B1)');

  -- ══ 1 · pedir código: solo un doctor verificado, desde su sesión ══
  perform tests.act_as(dn);
  begin perform public.wa_vinculo_codigo(); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '1 · un doctor sin verificar no conecta su WhatsApp');
  perform tests.act_as(d1);
  r := public.wa_vinculo_codigo(); v_cod := r ->> 'codigo';
  perform tests.ok(v_cod ~ '^RC-[0-9]{6}$' and r ->> 'enlace' like 'https://wa.me/526671647799?text=Conectar%20mi%20WhatsApp%20RC-%', '1 · código y enlace a nuestro WhatsApp con el texto listo');
  perform tests.ok(not (public.wa_vinculo_estado() ->> 'vinculado')::boolean, '1 · aún no vinculado');

  -- ══ 2 · el código llega por WhatsApp ══
  perform tests.act_as_service();
  r := public.cc_wa_vincular('5216679990001', 'RC-000000', v_conv);
  perform tests.ok(not (r ->> 'ok')::boolean and r ->> 'texto' like 'Ese código no es válido%', '2 · un código que no existe no liga y se le explica');
  r := public.cc_wa_vincular('5216679990001', lower(v_cod), v_conv);
  perform tests.ok((r ->> 'ok')::boolean and (r ->> 'profile_id')::uuid = d1 and public.cc_ia_identidad_canal(v_conv) = d1, '2 · con su código: la IA de esa conversación reconoce a d1');
  select content into t from public.cc_messages where conversation_id = v_conv and client_message_id like 'tpl:wa_vinculo:%' order by seq desc limit 1;
  perform tests.ok(t like '¡Listo%Ya reconozco tu WhatsApp%', '2 · confirmación por el mismo WhatsApp');
  perform tests.ok((select profile_id from public.cc_wa_contactos where wa_id = '5216679990001') is null
               and (select visitor_id from public.cc_conversations where id = v_conv) is not null, '2 · la conversación de WhatsApp NO se fusiona con la del portal');
  r := public.cc_wa_vincular('5216679990001', v_cod, v_conv);
  perform tests.ok(not (r ->> 'ok')::boolean, '2 · un código usado no sirve otra vez');

  -- otro doctor no puede quedarse con un WhatsApp ya vinculado
  perform tests.act_as(d2); v_cod := public.wa_vinculo_codigo() ->> 'codigo';
  perform tests.act_as_service();
  r := public.cc_wa_vincular('5216679990001', v_cod, v_conv);
  perform tests.ok(not (r ->> 'ok')::boolean and r ->> 'texto' like '%ya está conectado a otra cuenta%' and public.cc_ia_identidad_canal(v_conv) = d1, '2 · un WhatsApp vinculado no se lo queda otro');
  begin perform public.cc_wa_vincular('5216679990002', v_cod, v_conv); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '2 · el código solo vale para el WhatsApp de esa conversación');

  -- ══ 3 · el doctor lo ve y lo quita; si deja de estar verificado, la IA deja de reconocerlo ══
  perform tests.act_as(d1);
  r := public.wa_vinculo_estado();
  perform tests.ok((r ->> 'vinculado')::boolean and r ->> 'numero' = '•••• 0001', '3 · ve su número enmascarado');
  perform tests.act_as_service(); update public.profiles set verified = false where id = d1;
  perform tests.ok(public.cc_ia_identidad_canal(v_conv) is null, '3 · sin verificación vigente no hay identidad');
  update public.profiles set verified = true where id = d1;
  perform tests.act_as(d1);
  perform tests.ok((public.wa_vinculo_quitar() ->> 'quitados')::int = 1, '3 · lo quita');
  perform tests.act_as_service();
  perform tests.ok(public.cc_ia_identidad_canal(v_conv) is null, '3 · quitado: la IA ya no lo reconoce');

  -- ══ 4 · Dirección vincula a mano; un vendedor no ══
  r := public.cc_wa_entrante('5216679990009', 'Luis', 'wamid.VI.9', 'Buenas', false); v_conv2 := (r ->> 'conversation_id')::uuid;
  perform tests.act_as(s1);
  begin perform public.wa_vinculo_personal(v_conv2, d2); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '4 · un vendedor no vincula');
  perform tests.act_as(v_admin);
  begin perform public.wa_vinculo_personal(v_conv2, dn); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '4 · solo con un doctor verificado');
  perform public.wa_vinculo_personal(v_conv2, d2);
  perform tests.act_as_service();
  perform tests.ok(public.cc_ia_identidad_canal(v_conv2) = d2 and (select vinculado_via from public.cc_wa_contactos where wa_id = '5216679990009') = 'personal', '4 · Dirección vincula a mano');
  perform tests.ok(public._cc_wa_perfil('5216679990001') is null, '5 · R4-B1 en pie: el teléfono no liga');
  perform tests.ok(not has_function_privilege('authenticated', 'public.cc_ia_identidad_canal(uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.cc_wa_vincular(text,text,uuid)', 'EXECUTE'), '5 · identidad y vínculo por código solo del servidor');
end $t$;
rollback;
