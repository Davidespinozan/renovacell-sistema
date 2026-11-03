-- EQUIPO-LECTURAS (20270328) · palomitas azules y "escribiendo…" en el chat del equipo: cada quien marca lo suyo, lo ve
-- quien puede leer la conversación, nunca retrocede y el "escribiendo" vence solo.
begin;
do $t$
declare a1 uuid := tests.user('admin'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); w1 uuid := tests.user('warehouse'); d1 uuid := tests.user('doctor');
  dm uuid; gv uuid; m1 timestamptz; m2 timestamptz; r jsonb; x jsonb;
begin
  perform tests.act_as_owner();
  insert into public.conversations (kind, title, member_ids) values ('dm', 'Roberto', array[s1, s2]) returning id into dm;
  insert into public.conversations (kind, title, area, member_ids) values ('group', 'Ventas', 'pos', '{}') returning id into gv;
  insert into public.messages (conversation_id, sender_id, sender_name, body, created_at) values (dm, s1, 'R', 'uno', now() - interval '2 minutes') returning created_at into m1;
  insert into public.messages (conversation_id, sender_id, sender_name, body, created_at) values (dm, s1, 'R', 'dos', now() - interval '1 minute') returning created_at into m2;

  -- ══ 1 · el otro lee: s1 ve hasta dónde ══
  perform tests.act_as(s1);
  r := public.equipo_lectores(dm);
  perform tests.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'profile_id' = s2::text and r -> 0 -> 'leido_hasta' = 'null'::jsonb, '1 · en el directo, el lector es el otro; aún no lee');
  perform tests.act_as(s2);
  perform public.equipo_leido(dm, m1);
  perform tests.act_as(s1);
  perform tests.ok((public.equipo_lectores(dm) -> 0 ->> 'leido_hasta')::timestamptz = m1, '1 · leyó hasta el primero: el segundo aún en gris');
  perform tests.act_as(s2);
  perform public.equipo_leido(dm, now() + interval '1 hour');
  perform public.equipo_leido(dm, m1);
  perform tests.act_as(s1);
  perform tests.ok((public.equipo_lectores(dm) -> 0 ->> 'leido_hasta')::timestamptz = m2, '1 · nunca retrocede ni pasa del último mensaje');

  -- ══ 2 · escribiendo: aparece y vence solo ══
  perform tests.act_as(s2);
  perform public.equipo_escribiendo(dm, true);
  perform tests.act_as(s1);
  perform tests.ok((public.equipo_lectores(dm) -> 0 ->> 'escribiendo')::boolean, '2 · se ve que está escribiendo');
  perform tests.act_as_owner();
  update public.equipo_lecturas set escribiendo_hasta = now() - interval '1 second' where conversation_id = dm and profile_id = s2;
  perform tests.act_as(s1);
  perform tests.ok(not (public.equipo_lectores(dm) -> 0 ->> 'escribiendo')::boolean, '2 · vencido: ya no');
  perform tests.act_as(s2);
  perform public.equipo_escribiendo(dm, true); perform public.equipo_escribiendo(dm, false);
  perform tests.act_as(s1);
  perform tests.ok(not (public.equipo_lectores(dm) -> 0 ->> 'escribiendo')::boolean, '2 · al dejar de escribir se quita');

  -- ══ 3 · grupo: todos los que deben leerlo ══
  perform tests.act_as(s1);
  r := public.equipo_lectores(gv);
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) e where e ->> 'profile_id' = s2::text) and exists (select 1 from jsonb_array_elements(r) e where e ->> 'profile_id' = a1::text)
                   and not exists (select 1 from jsonb_array_elements(r) e where e ->> 'profile_id' in (s1::text, w1::text, d1::text)), '3 · grupo de Ventas: ventas y Dirección, sin mí ni otras áreas');

  -- ══ 4 · quién ve y quién escribe ══
  perform tests.act_as(w1);
  perform tests.throws(format('select public.equipo_lectores(%L)', dm), 'NO_AUTORIZADO', '4 · almacén no ve las lecturas de un directo ajeno');
  perform tests.throws(format('select public.equipo_leido(%L, now())', dm), 'NO_AUTORIZADO', '4 · ni marca leído');
  perform tests.eq((select count(*)::int from public.equipo_lecturas where conversation_id = dm), 0, '4 · ni lee la tabla (RLS)');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.equipo_escribiendo(%L, true)', dm), 'NO_AUTORIZADO', '4 · un doctor no');
  perform tests.act_as(s1);
  perform tests.eq((select count(*)::int from public.equipo_lecturas where conversation_id = dm), 1, '4 · los del directo sí leen la tabla');
  perform tests.throws(format('insert into public.equipo_lecturas (conversation_id, profile_id, leido_hasta) values (%L, %L, now())', dm, s2), 'permission denied', '4 · nadie escribe la tabla directo (ni por otro)');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'equipo_lecturas'), '4 · se transmite en vivo');
end $t$;
rollback;
