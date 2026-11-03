-- EQUIPO-ADJUNTOS (20270323) · imágenes, videos y documentos en el Chat del equipo: solo quien puede leer la conversación
-- ve o sube sus archivos (cada quien en su carpeta), el mensaje solo adjunta un archivo propio de esa conversación, y el
-- aviso al celular dice qué se mandó.
begin;
do $t$
declare
  a1 uuid := tests.user('admin'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); w1 uuid := tests.user('warehouse'); d1 uuid := tests.user('doctor');
  dm uuid; gv uuid; m uuid; r jsonb; n int; ok boolean;
  adj jsonb;
begin
  perform tests.act_as_owner();
  update public.profiles set full_name = 'Roberto Ibarra' where id = s1;
  insert into public.conversations (kind, title, member_ids) values ('dm', 'Roberto', array[s1, s2]) returning id into dm;
  insert into public.conversations (kind, title, area, member_ids) values ('group', 'Ventas', 'pos', '{}') returning id into gv;
  perform tests.ok(exists (select 1 from storage.buckets where id = 'equipo' and not public and file_size_limit = 52428800
                           and 'video/mp4' = any (allowed_mime_types) and 'application/pdf' = any (allowed_mime_types) and 'image/jpeg' = any (allowed_mime_types)), '0 · bucket privado de 50 MB con imágenes, videos y documentos');

  -- ══ 1 · subir: solo en conversaciones que puedes leer y en tu propia carpeta ══
  perform tests.act_as(s1);
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('equipo', dm || '/' || s1 || '/foto.jpg', s1, s1::text);
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('equipo', dm || '/' || s1 || '/Lista.pdf', s1, s1::text);
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('equipo', gv || '/' || s1 || '/video.mp4', s1, s1::text);
  perform tests.ok(true, '1 · el vendedor sube a su directo y a su grupo');
  begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('equipo', dm || '/' || s2 || '/x.jpg', s1, s1::text); ok := false; exception when others then ok := true; end;
  perform tests.ok(ok, '1 · no sube en la carpeta de otro');
  begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('equipo', 'cualquier/' || s1 || '/x.jpg', s1, s1::text); ok := false; exception when others then ok := true; end;
  perform tests.ok(ok, '1 · ni en una ruta que no es una conversación');
  perform tests.act_as(w1);
  begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('equipo', dm || '/' || w1 || '/x.jpg', w1, w1::text); ok := false; exception when others then ok := true; end;
  perform tests.ok(ok, '1 · almacén no sube a un directo ajeno');
  begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('equipo', gv || '/' || w1 || '/x.jpg', w1, w1::text); ok := false; exception when others then ok := true; end;
  perform tests.ok(ok, '1 · ni al grupo de Ventas');

  -- ══ 2 · ver: los de la conversación (y Dirección en los grupos); nadie más ══
  perform tests.act_as(s2);
  perform tests.eq((select count(*)::int from storage.objects where bucket_id = 'equipo'), 3, '2 · el otro del directo y del grupo ve los 3 archivos');
  perform tests.act_as(w1);
  perform tests.eq((select count(*)::int from storage.objects where bucket_id = 'equipo'), 0, '2 · almacén no ve ninguno');
  perform tests.act_as(d1);
  perform tests.eq((select count(*)::int from storage.objects where bucket_id = 'equipo'), 0, '2 · un doctor no ve ninguno');
  perform tests.act_as(a1);
  perform tests.eq((select count(*)::int from storage.objects where bucket_id = 'equipo'), 1, '2 · Dirección ve el del grupo, no el de un directo ajeno');

  -- ══ 3 · el mensaje solo adjunta un archivo propio de esa conversación ══
  perform tests.act_as(s1);
  adj := jsonb_build_object('path', dm || '/' || s1 || '/foto.jpg', 'nombre', 'foto.jpg', 'tipo', 'image/jpeg', 'tamano', 123456, 'clase', 'imagen');
  insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (dm, s1, 'Roberto Ibarra', '', adj) returning id into m;
  perform tests.ok((select adjunto ->> 'clase' = 'imagen' and (adjunto ->> 'tamano')::int = 123456 and body = '' from public.messages where id = m), '3 · imagen sin texto se manda');
  begin insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (dm, s1, 'R', '', adj || '{"path":"x"}'); ok := false; exception when check_violation then ok := sqlerrm like 'ADJUNTO_AJENO%'; end;
  perform tests.ok(ok, '3 · una ruta de otra parte: rechazada');
  begin insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (dm, s1, 'R', '', adj || jsonb_build_object('path', dm || '/' || s1 || '/no-existe.jpg')); ok := false; exception when check_violation then ok := sqlerrm like 'ADJUNTO_INEXISTENTE%'; end;
  perform tests.ok(ok, '3 · un archivo que no se subió: rechazado');
  begin insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (gv, s1, 'R', '', adj); ok := false; exception when check_violation then ok := sqlerrm like 'ADJUNTO_AJENO%'; end;
  perform tests.ok(ok, '3 · el archivo de un directo no se reenvía a un grupo por la ruta');
  begin insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (dm, s1, 'R', '', adj || '{"clase":"virus"}'); ok := false; exception when check_violation then ok := sqlerrm like 'ADJUNTO_INVALIDO%'; end;
  perform tests.ok(ok, '3 · clase desconocida: rechazada');
  begin insert into public.messages (conversation_id, sender_id, sender_name, body) values (dm, s1, 'R', '   '); ok := false; exception when check_violation then ok := sqlerrm like 'MENSAJE_VACIO%'; end;
  perform tests.ok(ok, '3 · sin texto ni archivo: no hay mensaje');
  perform tests.act_as(s2);
  begin insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (dm, s2, 'Beto', '', adj); ok := false; exception when check_violation then ok := sqlerrm like 'ADJUNTO_AJENO%'; end;
  perform tests.ok(ok, '3 · el otro no "manda" como suyo el archivo que subí yo');

  -- ══ 4 · el aviso dice qué se mandó ══
  perform tests.act_as_service();
  perform tests.eq(public.equipo_push_carga('mensaje', m) ->> 'body', '📷 Imagen', '4 · imagen sola: "📷 Imagen"');
  perform tests.act_as(s1);
  insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (dm, s1, 'Roberto Ibarra', 'Te paso la lista',
    jsonb_build_object('path', dm || '/' || s1 || '/Lista.pdf', 'nombre', 'Lista.pdf', 'tipo', 'application/pdf', 'clase', 'documento')) returning id into m;
  perform tests.act_as_service();
  perform tests.eq(public.equipo_push_carga('mensaje', m) ->> 'body', 'Te paso la lista', '4 · con texto: el texto');
  perform tests.act_as(s1);
  insert into public.messages (conversation_id, sender_id, sender_name, body, adjunto) values (gv, s1, 'Roberto Ibarra', '',
    jsonb_build_object('path', gv || '/' || s1 || '/video.mp4', 'nombre', 'video.mp4', 'tipo', 'video/mp4', 'clase', 'video')) returning id into m;
  perform tests.act_as_service();
  perform tests.eq(public.equipo_push_carga('mensaje', m) ->> 'body', 'Roberto Ibarra: 🎥 Video', '4 · en un grupo: quién y qué');
  perform tests.act_as(s1);
  insert into public.messages (conversation_id, sender_id, sender_name, body) values (dm, s1, 'Roberto Ibarra', 'solo texto') returning id into m;
  perform tests.act_as_service();
  perform tests.eq(public.equipo_push_carga('mensaje', m) ->> 'body', 'solo texto', '4 · los mensajes de texto siguen igual');

  -- ══ 5 · borrar: el autor o Dirección ══
  perform tests.act_as(s2);
  delete from storage.objects where bucket_id = 'equipo' and name = dm || '/' || s1 || '/foto.jpg';
  get diagnostics n = row_count;
  perform tests.eq(n, 0, '5 · el otro no borra mi archivo');
  perform tests.act_as(s1);
  delete from storage.objects where bucket_id = 'equipo' and name = dm || '/' || s1 || '/foto.jpg';
  get diagnostics n = row_count;
  perform tests.eq(n, 1, '5 · yo sí');
  perform tests.act_as(a1);
  delete from storage.objects where bucket_id = 'equipo' and name = gv || '/' || s1 || '/video.mp4';
  get diagnostics n = row_count;
  perform tests.eq(n, 1, '5 · Dirección borra en un grupo');
end $t$;
rollback;
