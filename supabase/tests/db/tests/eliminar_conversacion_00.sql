-- ELIMINAR CONVERSACIÓN (20270311) · solo Dirección, con motivo; se borra la conversación y lo que cuelga de ella (con
-- archivo y constancia); "olvidar contacto" quita también el WhatsApp y su visitante; lo demás no se toca.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); r jsonb; c1 uuid; c2 uuid; ok boolean; n_antes bigint;
begin
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001111', 'Prueba Spam', 'wamid.EL.1', 'hola', false); c1 := (r ->> 'conversation_id')::uuid;
  perform public.cc_wa_entrante('5216670001111', 'Prueba Spam', 'wamid.EL.2', 'precio botox', false);
  r := public.cc_wa_entrante('5216670002222', 'Cliente Real', 'wamid.EL.3', 'buen día', false); c2 := (r ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  select count(*) into n_antes from public.cc_messages where conversation_id = c2;

  -- permisos y motivo
  perform tests.act_as(s1);
  begin perform public.cc_conversacion_eliminar(c1, 'spam'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '0 · un vendedor no elimina conversaciones');
  perform tests.act_as(v_admin);
  begin perform public.cc_conversacion_eliminar(c1, ''); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '0 · sin motivo no se elimina');

  -- eliminar y olvidar
  r := public.cc_conversacion_eliminar(c1, 'contacto de prueba', true);
  perform tests.ok((r ->> 'eliminada')::boolean and r ->> 'contacto' like 'WhatsApp …1111%', '1 · eliminada (se identifica el contacto)');
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.cc_conversations where id = c1) and not exists (select 1 from public.cc_messages where conversation_id = c1)
               and not exists (select 1 from public.cc_wa_mensajes where wa_id = '5216670001111') and not exists (select 1 from public.cc_wa_contactos where wa_id = '5216670001111'), '1 · conversación, mensajes y contacto fuera');
  perform tests.ok((select count(*) from public.cc_purga_archivo where eliminacion_id = (r ->> 'eliminacion_id')::uuid) >= 5
               and exists (select 1 from public.cc_eliminaciones where id = (r ->> 'eliminacion_id')::uuid and eliminado_por = v_admin and motivo = 'contacto de prueba'), '1 · todo quedó en el archivo con constancia');
  perform tests.ok(exists (select 1 from public.cc_conversations where id = c2) and (select count(*) from public.cc_messages where conversation_id = c2) = n_antes, '1 · las demás conversaciones intactas');

  -- vuelve a escribir: contacto nuevo
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001111', 'Prueba Spam', 'wamid.EL.4', 'otra vez', false);
  perform tests.ok((r ->> 'conversation_id')::uuid is distinct from c1, '2 · si vuelve a escribir entra como contacto nuevo');

  -- sin olvidar: se va la conversación, el contacto queda
  perform tests.act_as(v_admin);
  perform public.cc_conversacion_eliminar(c2, 'conversación duplicada', false);
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.cc_wa_contactos where wa_id = '5216670002222'), '3 · sin "olvidar", el contacto se conserva');
  perform tests.ok(not has_function_privilege('authenticated', 'public._cc_purgar_rama(uuid,regclass,text,regclass[])', 'EXECUTE')
               and not has_table_privilege('authenticated', 'public.cc_purga_archivo', 'SELECT'), '4 · el borrado interno y el archivo no se exponen');
end $t$;
rollback;
