-- CC-1 · Visitante: abrir/reanudar por posesión del token (hash), atribución first/last
-- touch con política, referido opaco → vendedor, sin PII, sin acceso directo de clientes.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_pos2 uuid := tests.user('pos'); v_doc uuid := tests.user('doctor');
  h1 text := repeat('a', 64); h2 text := repeat('b', 64); h3 text := repeat('c', 64); h4 text := repeat('d', 64); hx text := repeat('e', 64);
  r jsonb; r2 jsonb; vid uuid; code text; v public.cc_visitors%rowtype;
  attr1 jsonb := '{"utm_source":"google","utm_campaign":"otoño","landing_path":"/","referrer":"https://www.google.com/?q=renovacell","basura":"x","utm_content":"<script>alert(1)</script>"}';
  attr2 jsonb := '{"utm_source":"facebook","fbclid":"abc123","landing_path":"/?fbclid=abc123"}';
begin
  -- ══ privilegios: ningún cliente ═════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.cc_visitors', 'permission denied', 'Q · anon no lee cc_visitors');
  perform tests.throws(format('select public.cc_visitante_abrir(null, %L)', h1), 'permission denied', 'anon no abre visitantes');
  perform tests.act_as(v_doc);
  perform tests.throws('select count(*) from public.cc_visitors', 'permission denied', 'R · authenticated no enumera visitantes');
  perform tests.throws('select count(*) from public.cc_visitor_events', 'permission denied', 'authenticated no lee la bitácora');
  perform tests.throws('select count(*) from public.cc_referral_codes', 'permission denied', 'authenticated no lista códigos de referido');
  perform tests.throws(format('select public.cc_visitante_abrir(null, %L)', h1), 'permission denied', 'authenticated no abre visitantes');
  perform tests.throws(format('select public.cc_visitante_adoptar(%L, %L)', h1, v_doc), 'permission denied', 'F · authenticated no invoca la adopción directa (el perfil lo deriva el servidor)');
  perform tests.throws('select public.cc_visitantes_purgar(90)', 'permission denied', 'authenticated no purga');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_visitante_adoptar(%L, %L)', h1, v_admin), 'permission denied', 'ni Dirección adopta a mano');

  -- ══ abrir: nuevo ════════════════════════════════════════════════════════
  perform tests.act_as_service();
  r := public.cc_visitante_abrir(null, h1, attr1, null);
  perform tests.eq((r ->> 'nuevo')::boolean, true, 'sin token → visitante nuevo');
  vid := (r ->> 'visitor_id')::uuid;
  perform tests.act_as_owner();
  select * into v from public.cc_visitors where id = vid;
  perform tests.eq(v.token_hash, h1, 'la base guarda el hash dado, no un token');
  perform tests.eq(v.first_touch ->> 'utm_source', 'google', 'first_touch capturado');
  perform tests.eq(v.first_touch ->> 'referrer', 'https://www.google.com/', 'referrer sin query');
  perform tests.ok(not (v.first_touch ? 'basura'), 'claves fuera de la lista blanca se descartan');
  perform tests.eq(v.first_touch ->> 'utm_content', '<script>alert(1)</script>', 'texto acotado se guarda como texto (nunca se ejecuta; la UI escapa)');
  perform tests.eq(v.last_touch ->> 'utm_source', 'google', 'last_touch = first_touch en la primera visita atribuible');
  perform tests.eq(v.visitas, 1, 'visitas = 1');
  perform tests.ok(v.seller_profile_id is null and v.referral_code is null, 'sin referido');
  perform tests.ok(not exists (select 1 from public.cc_visitor_events e where e.visitor_id = vid and (e.detalle::text ilike '%@%' or e.detalle::text ilike '%192.%')), 'P · bitácora sin PII');

  -- ══ abrir: reanudar con el mismo token ══════════════════════════════════
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(h1, h2, '{"landing_path":"/catalogo"}'::jsonb, null);   -- visita directa: NO atribuible
  perform tests.eq((r2 ->> 'nuevo')::boolean, false, 'token válido → reanuda');
  perform tests.eq((r2 ->> 'visitor_id')::uuid, vid, 'mismo visitante');
  perform tests.act_as_owner();
  select * into v from public.cc_visitors where id = vid;
  perform tests.eq(v.visitas, 2, 'visitas = 2');
  perform tests.eq(v.token_hash, h1, 'el hash NO se reemplaza al reanudar (h2 no se usó)');
  perform tests.ok(not exists (select 1 from public.cc_visitors where token_hash = h2), 'no se creó un segundo visitante');
  perform tests.eq(v.first_touch ->> 'utm_source', 'google', 'I · first_touch inmutable');
  perform tests.eq(v.last_touch ->> 'utm_source', 'google', 'J · navegación directa NO cambia last_touch');

  -- ══ last-touch: nueva visita atribuible sí cambia ════════════════════════
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(h1, h3, attr2, null);
  perform tests.act_as_owner();
  select * into v from public.cc_visitors where id = vid;
  perform tests.eq(v.first_touch ->> 'utm_source', 'google', 'I · first_touch sigue siendo google');
  perform tests.eq(v.last_touch ->> 'utm_source', 'facebook', 'J · last_touch = facebook (visita atribuible)');
  perform tests.eq(v.last_touch ->> 'landing_path', '/', 'landing_path sin query');
  perform tests.eq((select count(*)::int from public.cc_visitor_events where visitor_id = vid and tipo = 'last_touch'), 1, 'un evento last_touch');
  -- referrer interno no es atribuible
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(h1, h3, '{"referrer":"https://renovacell.mx/catalogo"}'::jsonb, null);
  perform tests.act_as_owner();
  perform tests.eq((select last_touch ->> 'utm_source' from public.cc_visitors where id = vid), 'facebook', 'J · referrer propio no cambia last_touch');

  -- ══ token inventado / revocado: visitante nuevo, sin revelar nada ═══════
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(hx, h3, '{}'::jsonb, null);
  perform tests.eq((r2 ->> 'nuevo')::boolean, true, 'A · token inventado → nuevo (no revela existencia)');
  perform tests.ok((r2 ->> 'visitor_id')::uuid <> vid, 'A · y no es el de otro');
  perform tests.act_as_owner();
  perform tests.ok((select first_touch is null and last_touch is null from public.cc_visitors where token_hash = h3), 'sin atribución → first/last nulos (no se inventa)');
  perform tests.throws(format('select public.cc_visitante_abrir(null, %L)', 'no-es-hash'), 'CC1_ARGUMENTOS', 'hash nuevo inválido rechazado');
  perform tests.throws('select public.cc_visitante_abrir(null, null)', 'CC1_ARGUMENTOS', 'hash nuevo nulo rechazado');

  -- ══ referido opaco → vendedor (resuelto en el servidor) ═════════════════
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cc_codigo_referido_crear(%L)', v_pos), 'NO_AUTORIZADO', 'K · un doctor no crea códigos');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.cc_codigo_referido_crear(%L)', v_pos), 'NO_AUTORIZADO', 'K · un vendedor no se crea su código');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_codigo_referido_crear(%L)', v_doc), 'VENDEDOR_INVALIDO', 'el código solo apunta a un vendedor activo');
  code := public.cc_codigo_referido_crear(v_pos);
  perform tests.ok(code ~ '^[A-Z2-7]{8}$', 'código opaco de 8 caracteres');
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(null, h4, '{"utm_source":"vendedor"}'::jsonb, lower(code));
  perform tests.act_as_owner();
  perform tests.eq((select seller_profile_id from public.cc_visitors where token_hash = h4), v_pos, 'Q · referido resuelto a profile UUID del vendedor (no lo eligió el cliente)');
  perform tests.eq((select referral_code from public.cc_visitors where token_hash = h4), code, 'código conservado');
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(null, repeat('f', 64), '{}'::jsonb, 'ZZZZZZZZ');
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id is null from public.cc_visitors where token_hash = repeat('f', 64)), 'L · referido inválido: sin vendedor, sin error (no revela)');
  -- revocado → deja de atribuir; vendedor suspendido → deja de atribuir
  perform tests.act_as(v_admin);
  perform tests.ok(public.cc_codigo_referido_revocar(code), 'Dirección revoca');
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(null, repeat('1', 64), '{}'::jsonb, code);
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id is null from public.cc_visitors where token_hash = repeat('1', 64)), 'código revocado no atribuye');
  perform tests.act_as(v_admin);
  code := public.cc_codigo_referido_crear(v_pos2);
  perform tests.act_as_owner();
  perform tests.suspender(v_pos2, 'prueba cc1');
  perform tests.act_as_service();
  r2 := public.cc_visitante_abrir(null, repeat('2', 64), '{}'::jsonb, code);
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id is null from public.cc_visitors where token_hash = repeat('2', 64)), 'vendedor suspendido no recibe atribución');

  -- ══ bitácora append-only; purga segura ══════════════════════════════════
  perform tests.throws(format('update public.cc_visitor_events set tipo = ''abierto'' where visitor_id = %L', vid), 'APPEND_ONLY', 'bitácora no se edita');
  perform tests.throws(format('delete from public.cc_visitor_events where visitor_id = %L', vid), 'APPEND_ONLY', 'bitácora no se borra');
  perform tests.act_as_service();
  perform tests.throws('select public.cc_visitantes_purgar(5)', 'CC1_ARGUMENTOS', 'retención mínima 30 días');
  perform tests.eq(public.cc_visitantes_purgar(90), 0, 'nada que purgar hoy');
  perform tests.act_as_owner();
  update public.cc_visitors set last_seen_at = now() - interval '100 days' where token_hash in (hx, h3);
  update public.cc_visitors set last_seen_at = now() - interval '100 days', pending_profile_id = v_doc where token_hash = h4;
  perform tests.act_as_service();
  perform tests.eq(public.cc_visitantes_purgar(90), 1, 'purga: solo el anónimo viejo sin vínculo (h3); el vinculado (h4) se conserva');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.cc_visitors where token_hash = h4) and exists (select 1 from public.cc_visitors where token_hash = h1), 'conservados: vinculado y reciente');

  -- ══ dedupe de prospectos con la nueva normalización ═════════════════════
  perform tests.eq(public.norm_telefono_mx('+52 (669) 123-4567'), '6691234567', 'L · +52 → 10 dígitos');
  perform tests.eq(public.norm_telefono_mx('52 1 669 123 4567'), '6691234567', 'L · 521 → 10 dígitos');
  perform tests.eq(public.norm_telefono_mx('044 669 123 4567'), '6691234567', 'L · 044 → 10 dígitos');
  perform tests.eq(public.norm_telefono_mx('6691234567'), '6691234567', 'L · nacional intacto');
  perform tests.eq(public.norm_telefono_mx('+1 (415) 555-0101'), '14155550101', 'L · internacional conservado íntegro (no se destruye)');
  perform tests.eq(public.norm_telefono_mx('+34 600 123 456'), '34600123456', 'L · España conservado');
  perform tests.eq(public.norm_telefono_mx('12345'), null::text, 'L · < 7 dígitos = nulo');
  perform tests.eq(public.norm_telefono_mx(null), null::text, 'L · nulo');
end $t$;
rollback;
