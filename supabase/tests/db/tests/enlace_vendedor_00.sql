-- ENLACE-VENDEDOR (20270211) · cada vendedor tiene su enlace y cada cliente uno para recomendar. Quien llega por un enlace
-- va con ese vendedor, salvo que ya sea cliente de cartera de otro (gana la cartera y al del enlace se le avisa). Lo público
-- solo dice con quién va a hablar y quién lo recomendó.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sNo uuid := tests.user('pos');
  d1 uuid := tests.user('doctor', 'cartera.s2@test.local'); dRef uuid := tests.user('doctor');
  hA text := repeat('a', 63) || '1'; hB text := repeat('b', 63) || '2'; hC text := repeat('c', 63) || '3'; hD text := repeat('d', 63) || '4';
  r jsonb; c1 text; c1b text; cRef text; cuRef uuid; cA uuid; cB uuid; cC uuid; vA uuid;
begin
  perform tests.act_as_service();
  update public.profiles set full_name = 'Roberto Ibarra', meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"],"avatar_url":"https://x/r.jpg"}' where id = s1;
  update public.profiles set full_name = 'Alejandra Carazarez', meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = s2;
  update public.profiles set full_name = 'Sin Capacidad' where id = sNo;
  perform tests.cliente(d1); insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s2);
  cuRef := tests.cliente(dRef); update public.customers set full_name = 'Dra. Lourdes Velázquez' where id = cuRef;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dRef, s1);

  -- ══ 1 · mi enlace: legible, uno por vendedor, estable ══
  perform tests.act_as(s1);
  r := public.cc_mi_enlace(); c1 := r ->> 'codigo';
  perform tests.eq(c1, 'roberto-ibarra', '1 · el enlace del vendedor lleva su nombre');
  perform tests.eq(public.cc_mi_enlace() ->> 'codigo', c1, '1 · pedirlo otra vez devuelve el mismo');
  perform tests.eq(r -> 'cifras', '{"visitas": 0, "contactos": 0, "cuentas": 0}'::jsonb, '1 · trae sus cifras');
  perform tests.act_as(sNo);
  perform tests.throws('select public.cc_mi_enlace()', 'NO_AUTORIZADO', '1 · sin atender conversaciones no hay enlace');
  perform tests.act_as_service();
  update public.profiles set full_name = 'Roberto Ibarra' where id = sNo;
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = sNo;
  perform tests.act_as(sNo);
  perform tests.eq(public.cc_mi_enlace() ->> 'codigo', 'roberto-ibarra-2', '1 · mismo nombre → otro código, nunca el de otro');
  perform tests.act_as_service(); update public.profiles set meta = meta - 'capabilities' where id = sNo;

  -- ══ 2 · el cliente recomienda: enlace con su nombre y un sufijo no adivinable; lleva a SU vendedor ══
  perform tests.act_as(dRef);
  r := public.cc_mi_enlace(); cRef := r ->> 'codigo';
  perform tests.ok(cRef ~ '^lourdes-[a-z2-9]{4}$', '2 · enlace para recomendar: primer nombre + 4 al azar (' || cRef || ')');
  perform tests.eq(r -> 'asesor' ->> 'primer_nombre', 'Roberto', '2 · sabe con quién va a llegar quien recomiende');

  -- ══ 3 · lo público: con quién hablas y quién te recomienda; nada más ══
  perform tests.act_as_service();   -- la Edge visitor (ver_enlace)
  r := public.cc_enlace_publico(c1);
  perform tests.eq(r, '{"valido": true, "tipo": "vendedor", "asesor": {"nombre": "Roberto Ibarra", "primer_nombre": "Roberto", "foto": "https://x/r.jpg"}, "recomienda": null}'::jsonb, '3 · enlace del vendedor: su nombre y foto');
  r := public.cc_enlace_publico(upper(cRef));
  perform tests.eq(r ->> 'recomienda', 'Lourdes', '3 · recomendación: solo el primer nombre de quien recomienda (sin "Dra.", sin apellidos)');
  perform tests.eq(r -> 'asesor' ->> 'nombre', 'Roberto Ibarra', '3 · y el asesor de su cartera');
  perform tests.eq(public.cc_enlace_publico('no-existe'), '{"valido": false}'::jsonb, '3 · código desconocido: no válido');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_enlace_publico(%L)', c1), 'permission denied', '3 · solo por la Edge: anónimo no lo llama directo');
  perform tests.throws('select public._cc_enlace_de_vendedor(gen_random_uuid())', 'permission denied', '3 · anónimo no crea enlaces');
  perform tests.throws('select count(*) from public.cc_enlaces', 'permission denied', '3 · ni lee la tabla');
  perform tests.throws(format('select public.cc_visitante_enlace(%L, %L)', hA, c1), 'permission denied', '3 · ni atribuye visitantes');

  -- ══ 4 · llega por el enlace de Roberto, sin coincidencia → la conversación es de Roberto ══
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); vA := public._cc_visitor_por_hash(hA);
  r := public.cc_visitante_enlace(hA, c1);
  perform tests.eq(r -> 'asesor' ->> 'primer_nombre', 'Roberto', '4 · la página sabe a quién saludar');
  perform tests.ok((select enlace_codigo = c1 and seller_profile_id = s1 and referido_por is null from public.cc_visitors where id = vA), '4 · queda la atribución');
  perform public.cc_visitante_enlace(hA, 'alejandra-carazarez');
  perform tests.eq((select enlace_codigo from public.cc_visitors where id = vA), c1, '4 · gana el PRIMER enlace');
  perform public.cc_visitante_prerregistrar(hA, 'Nueva Prospecta', '6695550101', 'nueva.prospecta@test.local', false, null, true);
  perform tests.ok((select assigned_to = s1 and source = 'Enlace del vendedor' and meta ->> 'enlace' = c1 from public.prospects where visitor_id = vA), '4 · el prospecto es de Roberto');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'contacto_enlace' and user_ids = array[s1] and body = 'Nuevo contacto por tu enlace: Nueva Prospecta'), '4 · a Roberto le avisan (no a Dirección)');
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:a1', 'Hola');
  perform tests.eq(public.cc_enlace_auto_asesor(cA, hA) ->> 'asesor', 'true', '4 · su primer mensaje entra a la cola con asesor');
  perform tests.ok((select seller_profile_id = s1 and modo = 'human_assigned' from public.cc_conversations where id = cA), '4 · asignada a Roberto, sin reparto');
  perform tests.act_as(s1);
  perform tests.eq(public.cc_origen_conversacion(cA) ->> 'es_tuyo', 'true', '4 · Roberto ve que llegó por SU enlace');
  perform tests.eq((public.cc_mi_enlace() -> 'cifras' ->> 'contactos')::int, 1, '4 · y su cifra de contactos sube');

  -- ══ 5 · gana la cartera: por el enlace de Roberto llega una clienta de Alejandra ══
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null);
  perform public.cc_visitante_enlace(hB, c1);
  perform public.cc_visitante_prerregistrar(hB, 'Clienta De Alejandra', '6695550102', 'cartera.s2@test.local', false, null, true);
  perform tests.ok((select assigned_to = s2 from public.prospects where visitor_id = public._cc_visitor_por_hash(hB)), '5 · el prospecto queda con su vendedora de cartera');
  perform tests.ok(exists (select 1 from public.notifications where user_ids = array[s1] and body = 'Un contacto de tu enlace ya es cliente de Alejandra Carazarez: la conversación le llega a esa persona.'), '5 · a Roberto se le avisa');
  cB := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cB, 'visitor', hB, null, 'c:b1', 'Hola');
  perform public.cc_enlace_auto_asesor(cB, hB);
  perform tests.eq((select seller_profile_id from public.cc_conversations where id = cB), s2, '5 · la conversación es de Alejandra');
  perform tests.eq((select count(*)::int from public.notifications where event_key = 'enlace_conflicto:' || public._cc_visitor_por_hash(hB)::text), 1, '5 · un solo aviso de conflicto');

  -- ══ 6 · recomendación de un cliente → su vendedor; queda quién recomendó ══
  perform public.cc_visitante_abrir(null, hC, '{}'::jsonb, null);
  perform public.cc_visitante_enlace(hC, cRef);
  perform public.cc_visitante_prerregistrar(hC, 'Amiga De Lourdes', '6695550103', 'amiga@test.local', true, null, true);
  perform tests.ok((select assigned_to = s1 and source = 'Recomendación' and (meta ->> 'referido_por')::uuid = cuRef from public.prospects where visitor_id = public._cc_visitor_por_hash(hC)), '6 · prospecto de Roberto, origen Recomendación, con quién la recomendó');
  perform tests.ok(exists (select 1 from public.notifications where user_ids = array[s1] and body = 'Te recomendaron: Amiga De Lourdes (de parte de Lourdes)'), '6 · el aviso dice quién la recomendó');
  cC := (public.cc_abrir_conversacion(hC, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cC, 'visitor', hC, null, 'c:c1', 'Hola, me recomendó Lourdes');
  perform public.cc_enlace_auto_asesor(cC, hC);
  perform tests.eq((select seller_profile_id from public.cc_conversations where id = cC), s1, '6 · la conversación es de Roberto');
  perform tests.act_as(s1);
  perform tests.eq(public.cc_origen_conversacion(cC) ->> 'recomienda', 'Dra. Lourdes Velázquez', '6 · quien atiende ve el nombre completo de quien recomendó');
  perform tests.act_as(s2);
  perform tests.throws(format('select public.cc_origen_conversacion(%L)', cC), 'NO_AUTORIZADO', '6 · otro vendedor no ve el origen de una conversación ajena');

  -- ══ 7 · vendedor que ya no atiende: su enlace no asigna (sigue el reparto o Dirección) ══
  perform tests.act_as_service();
  update public.profiles set meta = meta - 'capabilities' where id = s1;
  perform public.cc_visitante_abrir(null, hD, '{}'::jsonb, null);
  perform tests.eq(public.cc_visitante_enlace(hD, c1) -> 'asesor', 'null'::jsonb, '7 · la página ya no promete a ese asesor');
  perform public.cc_visitante_prerregistrar(hD, 'Sin Asesor', '6695550104', 'sin.asesor@test.local', false, null, true);
  perform tests.ok((select assigned_to is null from public.prospects where visitor_id = public._cc_visitor_por_hash(hD)), '7 · el prospecto no se asigna a quien ya no atiende');

  -- ══ 8 · Dirección ve el enlace de cada vendedor ══
  update public.profiles set meta = meta || '{"capabilities":["conversaciones"]}' where id = s1;
  perform tests.act_as(v_admin);
  r := public.cc_enlaces_equipo();
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) x where x ->> 'codigo' = c1 and (x -> 'cifras' ->> 'visitas')::int >= 2), '8 · con sus cifras');
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) x where x ->> 'codigo' = 'alejandra-carazarez'), '8 · crea el de quien no lo tenía');
  perform tests.act_as(s2);
  perform tests.throws('select public.cc_enlaces_equipo()', 'NO_AUTORIZADO', '8 · un vendedor no ve los de los demás');
end $t$;
rollback;
