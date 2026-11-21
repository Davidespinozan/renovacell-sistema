-- DIFUSIÓN AL PORTAL CON AVISO (21 nov 2026: «llegó por correo y WhatsApp pero no al portal»). Sí llegaba: quedaba como
-- tarjeta en el chat del portal del doctor, pero sin campanita ni notificación al celular, así que nadie la veía. Ahora el
-- doctor recibe además un aviso (campanita + push si los tiene activados) que abre «Habla con Renovacell».
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.difusion_enviar'::regproc);
  if position('insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, ''chat'', ''entregado''); d.n_chat := d.n_chat + 1;' in d) = 0 then
    raise exception 'DIF-AVISO: cambió difusion_enviar'; end if;
  d := replace(d, 'insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, ''chat'', ''entregado''); d.n_chat := d.n_chat + 1;',
'insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, ''chat'', ''entregado''); d.n_chat := d.n_chat + 1;
        perform public._cc_notificar(''difusion'', v_conv, array[c.profile_id], null, left(''Renovacell: '' || coalesce(p_titulo, ''tienes un mensaje nuevo''), 300), ''chat_cc'',
          ''difusion:'' || d.id::text || '':'' || c.profile_id::text);   -- DIF-AVISO · campanita + push');
  execute d;

  d := pg_get_functiondef('public.aviso_push_carga(uuid)'::regprocedure);
  if position('''efectivo_chofer'' then ''💵 Efectivo recibido'' else' in d) = 0 then raise exception 'DIF-AVISO: cambió aviso_push_carga'; end if;
  d := replace(d, '''efectivo_chofer'' then ''💵 Efectivo recibido'' else', '''efectivo_chofer'' then ''💵 Efectivo recibido'' when ''difusion'' then ''📣 Renovacell'' else');
  execute d;
end $patch$;

drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind = any (array['handoff_asignado','handoff_aviso','handoff_escalado','handoff_sin_vendedor','retoma','cliente_escribe',
                              'senal_compra','verificacion_wa','link_pago','error_app','envio_chofer','envio_regreso','efectivo_chofer','difusion']))
  execute function public._cc_aviso_push_tr();
