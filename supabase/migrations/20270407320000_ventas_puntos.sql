-- VENTAS · PUNTOS QUE FALTABAN (19 nov 2026, dueño: «corrige los puntos»).
--   1. (Link de pago pedido por la vendedora: solo pantalla; el servidor ya lo permitía.)
--   2. Conversaciones que se quedaban SIN DUEÑA: si en 24 h ninguna vendedora contesta y ya no hay más a quién pasarla, ya
--      no se suelta; queda FIJA en la cartera de la última vendedora (con aviso a ella) y Dirección solo se entera.
--   3. Un mismo celular en dos carteras: «Escribir a un cliente» decía «no es tu cliente»; ahora dice de quién es y que
--      Dirección una las dos fichas.
--   4. Cliente SIN vendedora asignada: se le podía vender pero no cotizar ni guardar domicilio. Ahora cualquier vendedora
--      lo atiende completo (misma regla que pedidos y links de pago). Los clientes de OTRA vendedora siguen protegidos.
do $pre$ begin
  if position('  update public.cc_conversations set customer_id = p_customer, updated_at = now() where id = v_conv and customer_id is null and profile_id is null;' in pg_get_functiondef('public.cc_wa_escribir_cliente(uuid,text,uuid)'::regprocedure)) = 0
     or position('  if v_rol = ''doctor'' and v_profile is not null and v_profile = auth.uid() then return ''dueno''; end if;' in pg_get_functiondef('public._c360_actor(uuid)'::regprocedure)) = 0
     or position('    if v_next is null then
      delete from public.cc_reparto_contacto where conversation_id = r.conversation_id;' in pg_get_functiondef('public.cc_reparto_contacto_evaluar()'::regprocedure)) = 0 then
    raise exception 'VENTAS-PUNTOS: cambiaron las funciones; revisar los parches'; end if;
end $pre$;

do $patch$
declare d text;
begin
  -- 2. sin más vendedoras: se queda fija con la última
  d := pg_get_functiondef('public.cc_reparto_contacto_evaluar()'::regprocedure);
  d := replace(d, '    if v_next is null then
      delete from public.cc_reparto_contacto where conversation_id = r.conversation_id;
      perform public._cc_notificar(''contacto_sin_respuesta'', r.conversation_id, null, array[''admin''],
        format(''%s no recibió respuesta en 24 h y ya no hay más vendedoras disponibles. Asígnalo desde la Bandeja.'', v_nombre), ''av_atencion'',',
'    if v_next is null then
      -- VENTAS-PUNTOS · ya no se suelta: queda en la cartera de la última vendedora (6 meses), con aviso.
      perform public._cc_reparto_contacto_fijar(r.conversation_id, r.seller_profile_id, now());
      perform public._cc_notificar(''contacto_asignado'', r.conversation_id, array[r.seller_profile_id], null,
        format(''%s quedó en tu cartera: nadie le respondió en 24 h. Escríbele hoy.'', v_nombre), ''asesorias'',
        ''contacto_fijo:'' || r.conversation_id::text || '':'' || r.seller_profile_id::text);
      perform public._cc_notificar(''contacto_sin_respuesta'', r.conversation_id, null, array[''admin''],
        format(''%s no recibió respuesta en 24 h; quedó con %s. Reasígnalo si hace falta.'', v_nombre, coalesce(public._cc_nombre_personal(r.seller_profile_id), ''la última vendedora'')), ''av_atencion'',');
  execute d;

  -- 3. número que ya es de otro cliente de otra vendedora: mensaje claro
  d := pg_get_functiondef('public.cc_wa_escribir_cliente(uuid,text,uuid)'::regprocedure);
  d := replace(d, '  update public.cc_conversations set customer_id = p_customer, updated_at = now() where id = v_conv and customer_id is null and profile_id is null;',
'  if exists (select 1 from public.cc_conversations cv where cv.id = v_conv and cv.customer_id is not null and cv.customer_id <> p_customer
               and public.auth_role() <> ''admin'' and public._cc_vendedor_de_cliente(cv.customer_id) is distinct from a.uid) then
    raise exception ''PLANTILLA_NUMERO_OCUPADO: ese celular ya está en la ficha de «%» (cartera de %). Pídele a Dirección que una las dos fichas'',
      (select initcap(lower(cu2.full_name)) from public.cc_conversations cv join public.customers cu2 on cu2.id = cv.customer_id where cv.id = v_conv),
      coalesce(public._cc_nombre_personal(public._cc_vendedor_de_cliente((select cv.customer_id from public.cc_conversations cv where cv.id = v_conv))), ''otra vendedora'')
      using errcode = ''check_violation'';
  end if;
  update public.cc_conversations set customer_id = p_customer, updated_at = now() where id = v_conv and customer_id is null and profile_id is null;');
  execute d;

  -- 4. cliente sin vendedora: cualquier vendedora lo atiende completo
  d := pg_get_functiondef('public._c360_actor(uuid)'::regprocedure);
  d := replace(d, '  if v_rol = ''doctor'' and v_profile is not null and v_profile = auth.uid() then return ''dueno''; end if;',
'  -- VENTAS-PUNTOS · cliente SIN vendedora asignada: cualquier vendedora lo atiende (igual que pedidos y links de pago).
  if v_rol = ''pos'' and public._cc_vendedor_de_cliente(p_customer) is null then return ''vendedor''; end if;
  if v_rol = ''doctor'' and v_profile is not null and v_profile = auth.uid() then return ''dueno''; end if;');
  execute d;
end $patch$;

do $post$ begin
  if position('contacto_fijo:' in pg_get_functiondef('public.cc_reparto_contacto_evaluar()'::regprocedure)) = 0
     or position('PLANTILLA_NUMERO_OCUPADO' in pg_get_functiondef('public.cc_wa_escribir_cliente(uuid,text,uuid)'::regprocedure)) = 0
     or position('VENTAS-PUNTOS' in pg_get_functiondef('public._c360_actor(uuid)'::regprocedure)) = 0 then raise exception 'VENTAS-PUNTOS: no quedó aplicada'; end if;
end $post$;
