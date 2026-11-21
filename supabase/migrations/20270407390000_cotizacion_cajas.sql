-- CAJAS-MEDIOS · el correo de cotización muestra los ultrafiltrados en cajas (1½ cajas), no en medias internas.
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.cc_cotizacion_enviar(uuid,text)'::regprocedure);
  if position('''qty'', (x ->> ''qty'')::int, ''unit_price''' in d) = 0 then raise exception 'COT-CAJAS: cambió cc_cotizacion_enviar'; end if;
  d := replace(d, '''qty'', (x ->> ''qty'')::int, ''unit_price''',
    '''qty'', (x ->> ''qty'')::int, ''media_caja'', exists (select 1 from public.products pm where pm.id::text = x ->> ''product_id'' and pm.unit ilike ''media caja%''), ''unit_price''');
  execute d;
end $patch$;
