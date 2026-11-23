-- IA · TANDA 2 (20270407480000) · búsqueda tolerante (errores de dedo, presentaciones, sinónimos) sin perder la visibilidad
-- por audiencia; lo que la IA puede afirmar (cc_ia_producto_estado: sí/no se surte, presentación no manejada, alternativas;
-- sin cifras ni productos internos); el aviso de verificación sin «verificado(a)», sin enlaces técnicos y sin hablar encima
-- del vendedor. Conversaciones reales: A·C2 seq4 «linurasse», B·C3 seq32 «Xeomeen», A·C4 seq4 «nabota de 200 unidades»,
-- B·C2 seq3 «innotox de 100 u», A·C0 seq3 «tirzepatida», A·C1 seq4 «Hyalux Deep», A·C0 seq15 (enlace supabase.co).
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); d1 uuid := tests.user('doctor');
  pLin uuid; pXeo uuid; pN100 uuid; pN200 uuid; pI100 uuid; pI50 uuid; pW200 uuid; pBtx uuid; pMou uuid; pInt uuid; pOff uuid;
  r jsonb; n int; c1 uuid; v_sol uuid; t text;
begin
  perform tests.act_as_service();
  pLin := tests.producto_fam('Toxinas', 'Linurase'); pXeo := tests.producto_fam('Toxinas', 'Xeomeen'); pN100 := tests.producto_fam('Toxinas', 'NABOTA');
  pN200 := tests.producto_fam('Toxinas', 'NABOTA'); pI100 := tests.producto_fam('Toxinas', 'INNOTOX'); pI50 := tests.producto_fam('Toxinas', 'INNOTOX');
  pW200 := tests.producto_fam('Toxinas', 'WONDERTOX'); pBtx := tests.producto_fam('Toxinas', 'Botox'); pMou := tests.producto_cat('Metabólicos');
  pInt := tests.producto_fam('Toxinas', 'Interno'); pOff := tests.producto_fam('Toxinas', 'Descontinuado');
  update public.products set name = 'Linurase 100 UI', show_landing = false where id = pLin;
  update public.products set name = 'Xeomeen 100 UI' where id = pXeo;
  update public.products set name = 'NABOTA 100 UI', show_landing = false where id = pN100;
  update public.products set name = 'NABOTA 200 UI', show_landing = false where id = pN200;
  update public.products set name = 'INNOTOX 100 UI', show_landing = false where id = pI100;
  update public.products set name = 'INNOTOX 50 UI', show_landing = false where id = pI50;
  update public.products set name = 'Wondertox 200 UI', show_landing = false where id = pW200;
  update public.products set name = 'Botox 100 UI' where id = pBtx;
  update public.products set name = 'MOUNJARO KWIKPEN 5 mg' where id = pMou;
  update public.products set name = 'Toxina Interna 200 UI', show_landing = false, show_portal = false where id = pInt;   -- interno: nunca sale
  update public.products set name = 'Stemtox 100 UI', active = false where id = pOff;                                  -- inactivo
  perform tests.stock(pLin, 'L-LIN', 10); perform tests.stock(pXeo, 'L-XEO', 5); perform tests.stock(pN100, 'L-N100', 8);
  perform tests.stock(pW200, 'L-W200', 4); perform tests.stock(pBtx, 'L-BTX', 6); perform tests.stock(pInt, 'L-INT', 9);
  -- NABOTA 200, INNOTOX 100/50 y MOUNJARO sin existencia

  -- ══ 1 · búsqueda tolerante (misma firma, misma visibilidad) ══
  perform tests.eq(public._cc_ia_q('10 Linurase de 100 unidades'), 'linurase 100 ui', '1 · cantidad, relleno y presentación normalizados');
  perform tests.eq(public._cc_ia_q('nabota 200u'), 'nabota 200 ui', '1 · «200u» → «200 ui»');
  perform tests.eq(public._cc_ia_q('Tirzepatida'), 'mounjaro', '1 · genérico → marca (sinónimo de palabra completa)');
  perform tests.eq(public._cc_ia_q('terapia neural'), 'tnm', '1 · «terapia neural» → TNM');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('nabota 200u', 10, 'verified') b limit 1), pN200, '1 · «nabota 200u» encuentra NABOTA 200 UI por nombre');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('linurasse', 10, 'verified') b limit 1), pLin, '1 · A·C2 seq4 «linurasse» (sinónimo) → Linurase 100 UI');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('Xeomin', 10, 'public') b limit 1), pXeo, '1 · B·C3 seq32 «Xeomin» → Xeomeen 100 UI');
  perform tests.eq((select b.product_id from public.cc_buscar_productos('tirze', 10, 'public') b limit 1), pMou, '1 · A·C0 seq3 «tirze» → MOUNJARO');
  select b.coincidencia, b.puntaje into t, n from public.cc_buscar_productos('Xeomeenn', 10, 'public') b where b.product_id = pXeo;
  perform tests.ok(t = 'parecido' and n between 60 and 70, '1 · un error de dedo sin sinónimo = «parecido» con < 75 (la pre-búsqueda nunca lo confirma sola)');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('botox', 10, 'public') b where b.coincidencia = 'parecido'), '1 · con coincidencia fuerte no se agregan parecidos');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('innotox 100', 10, 'public') b), '1 · público: lo que no está en la landing no aparece (tampoco «Botox parecido»)');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('toxina interna', 10, 'staff') b where b.product_id = pInt), '1 · lo interno no aparece ni por parecido');
  perform tests.ok(not exists (select 1 from public.cc_buscar_productos('hyalux deep', 10, 'verified') b), '1 · A·C1 seq4 lo que no existe = vacío (no inventa)');

  -- ══ 2 · lo que la IA puede afirmar ══
  r := public.cc_ia_producto_estado('innotox de 100 u', 'public');
  perform tests.ok(r ->> 'coincidencia' = 'exacta' and r -> 'pedidos' -> 0 ->> 'nombre' = 'INNOTOX 100 UI' and (r -> 'pedidos' -> 0 ->> 'disponible_ahora')::boolean = false,
                   '2 · B·C2 seq3 INNOTOX 100 sin existencia: «no disponible ahora»');
  perform tests.ok(r -> 'pedidos' -> 0 ->> 'product_id' is null and (r -> 'pedidos' -> 0 ->> 'solo_para_profesionales')::boolean, '2 · al público: sin id de lo que no ve, solo el nombre');
  perform tests.ok(r -> 'alternativas' -> 0 ->> 'nombre' in ('Botox 100 UI', 'Xeomeen 100 UI', 'Linurase 100 UI', 'NABOTA 100 UI') and jsonb_array_length(r -> 'alternativas') <= 3,
                   '2 · alternativas con existencia (misma presentación primero), máximo 3');
  perform tests.ok(r::text !~ '"(disponible|existencia|stock|cantidad)": *[0-9]' and r::text not like '%Toxina Interna%', '2 · sin cifras y sin productos internos');
  r := public.cc_ia_producto_estado('nabota de 200 unidades', 'verified');
  perform tests.ok((r -> 'pedidos' -> 0 ->> 'disponible_ahora')::boolean = false and r -> 'alternativas' -> 0 ->> 'nombre' = 'NABOTA 100 UI'
                   and r -> 'alternativas' -> 1 ->> 'nombre' = 'Wondertox 200 UI', '2 · Nabota 200 agotado → Nabota 100 (misma marca) y Wondertox 200 (misma presentación), como la vendedora');
  r := public.cc_ia_producto_estado('nabota 150 ui', 'verified');
  perform tests.ok((r ->> 'presentacion_no_manejada')::boolean and r ->> 'presentacion_pedida' = '150 UI' and jsonb_array_length(r -> 'pedidos') = 0, '2 · presentación que no manejamos');
  r := public.cc_ia_producto_estado('linurase', 'public');
  perform tests.ok((r -> 'pedidos' -> 0 ->> 'disponible_ahora')::boolean and not (r ? 'alternativas'), '2 · con existencia: sin alternativas');
  perform tests.eq(public.cc_ia_producto_estado('hyalux deep', 'verified') ->> 'coincidencia', 'ninguna', '2 · no aparece → «ninguna» (la IA no lo afirma)');
  perform tests.eq(public.cc_ia_producto_estado('stemtox', 'verified') -> 'pedidos' -> 0 ->> 'se_vende', 'false', '2 · inactivo: existe pero no se vende');
  perform tests.ok(coalesce(public.cc_ia_producto_estado('toxina interna 200', 'staff')::text, '') not like '%Toxina Interna%', '2 · lo interno nunca es «lo que pidió» ni alternativa');
  perform tests.act_as(d1);
  perform tests.throws('select public.cc_ia_producto_estado(''botox'', ''public'')', 'permission denied', '2 · solo el servidor');
  perform tests.act_as_owner();
  perform tests.ok(not has_function_privilege('anon', 'public.cc_ia_producto_estado(text,text)', 'EXECUTE') and not has_function_privilege('authenticated', 'public._cc_ia_q(text)', 'EXECUTE'), '2 · sin grants al cliente');

  -- ══ 3 · aviso de verificación: neutro, sin enlaces técnicos, sin hablar encima del vendedor ══
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216671239876', 'Alejandra', 'wamid.T2.1', 'Tirzepatidas', false); c1 := (r ->> 'conversation_id')::uuid;
  perform public.cc_ia_solicitar_alta(c1, 'Alejandra Ruiz', '12345678', 'ale@x.mx');
  select id into v_sol from public.cc_solicitudes_alta where conversation_id = c1;
  r := public.cc_alta_wa_cerrar(v_sol, null, d1, v_admin, 'https://amurlvlvfohwucvxfdot.supabase.co/auth/v1/verify?token=abc&type=recovery', true);
  select content into t from public.cc_messages where conversation_id = c1 and client_message_id like 'tpl:alta_wa:%';
  perform tests.ok(t not like '%supabase.co%' and t like '%sistema.renovacell.mx%¿Olvidaste tu contraseña?%' and (r ->> 'enlace_descartado')::boolean, '3 · A·C0 seq15 un enlace técnico se descarta (queda «¿Olvidaste tu contraseña?»)');
  perform tests.ok(t like '¡Listo, Alejandra! Tu cuenta quedó verificada en Renovacell.%' and t not like '%(a)%', '3 · sin «verificado(a)»');
  perform tests.ok(t like '%¿Te cotizo lo que me pediste?' and not (r ->> 'aviso_corto')::boolean, '3 · sin vendedor activo: el aviso completo');

  -- con una persona del equipo escribiendo hace un momento: aviso corto, sin «te cotizo» (A·C0 seq13-15)
  r := public.cc_wa_entrante('5216671239877', 'Blanca', 'wamid.T2.2', 'Hola', false); c1 := (r ->> 'conversation_id')::uuid;
  -- (el canal de prueba está en espejo: la línea del vendedor se inserta sin disparadores, SOLO en esta prueba)
  perform tests.act_as_owner();
  perform set_config('session_replication_role', 'replica', true);
  insert into public.cc_messages (conversation_id, seq, actor_type, actor_profile_id, content, content_hash)
  select c1, ultimo_seq + 1, 'seller', s1, 'Hola buen día, te atiende Alejandra', md5('x') from public.cc_conversations where id = c1;
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1 where id = c1;
  perform set_config('session_replication_role', 'origin', true);
  perform tests.act_as_service();
  perform public.cc_ia_solicitar_alta(c1, 'Blanca López', '87654321', 'blanca@x.mx');
  select id into v_sol from public.cc_solicitudes_alta where conversation_id = c1;
  r := public.cc_alta_wa_cerrar(v_sol, null, tests.user('doctor'), v_admin, 'https://sistema.renovacell.mx/sistema#token_hash=abcdefabcdefabcdef&type=recovery', true);
  select content into t from public.cc_messages where conversation_id = c1 and client_message_id like 'tpl:alta_wa:%';
  perform tests.ok((r ->> 'aviso_corto')::boolean and t not like '%Te cotizo%' and t not like '%te doy tus precios%' and t like '%https://sistema.renovacell.mx/sistema#token_hash=abcdefabcdefabcdef&type=recovery%',
                   '3 · con el vendedor activo: aviso corto con su enlace de la app, sin hablar encima');
end $t$;
rollback;
