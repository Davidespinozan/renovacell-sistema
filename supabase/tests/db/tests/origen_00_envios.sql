-- ORIGEN DE ENVÍOS ESTRUCTURADO (183) · Dirección captura calle/número/colonia/referencias; la línea de dirección se arma sola
-- (una sola verdad para DHL) y se rechaza si pasa de 45; sin campos nuevos, shipping_address queda como estaba (compatibilidad);
-- el fiscal no se toca; solo Dirección escribe (política existente).
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); r record;
begin
  perform tests.act_as_owner();
  update public.company_settings set shipping_address = 'Nuevo Mundo 1045-17', shipping_cp = '80197', shipping_city = 'Culiacán', shipping_state = 'Sinaloa', direccion = 'Boulevard Pedro Infante 2911', cp = '80020', shipping_street = null, shipping_ext_number = null where id = 'default';

  -- ══ 1 · compatibilidad: sin campos nuevos, la línea no cambia ═══════════════════════════════════
  perform tests.act_as(v_admin);
  update public.company_settings set shipping_phone = '6671647799' where id = 'default';
  select * into r from public.company_settings where id = 'default';
  perform tests.ok(r.shipping_address = 'Nuevo Mundo 1045-17' and r.shipping_street is null and r.shipping_colonia is null, '1 · sin campos nuevos shipping_address queda igual (DHL sigue)');

  -- ══ 2 · estructurado: la línea se arma sola; interior opcional; fiscal intacto ═════════════════
  update public.company_settings set shipping_street = ' Nuevo Mundo ', shipping_ext_number = '1045', shipping_int_number = '17', shipping_colonia = ' Las Quintas ', shipping_references = 'Local 17, frente al parque' where id = 'default';
  select * into r from public.company_settings where id = 'default';
  perform tests.eq(r.shipping_address, 'Nuevo Mundo 1045 17', '2 · shipping_address = calle + exterior + interior');
  perform tests.ok(r.shipping_street = 'Nuevo Mundo' and r.shipping_colonia = 'Las Quintas' and r.shipping_references = 'Local 17, frente al parque', '2 · campos recortados');
  perform tests.ok(r.direccion = 'Boulevard Pedro Infante 2911' and r.cp = '80020', '2 · el domicilio fiscal no se toca');
  update public.company_settings set shipping_int_number = '' where id = 'default';
  perform tests.eq((select shipping_address from public.company_settings where id = 'default'), 'Nuevo Mundo 1045', '2 · sin interior');

  -- ══ 3 · validación: calle sin número, número sin calle, más de 45 caracteres ═════════════════════
  perform tests.throws($q$update public.company_settings set shipping_ext_number = null where id = 'default'$q$, 'número exterior', '3 · calle sin número exterior');
  perform tests.throws($q$update public.company_settings set shipping_street = null, shipping_ext_number = '5' where id = 'default'$q$, 'captura la calle', '3 · número sin calle');
  perform tests.throws($q$update public.company_settings set shipping_street = 'Boulevard Licenciado Pedro Infante Cruz Norte', shipping_ext_number = '2911' where id = 'default'$q$, '45', '3 · más de 45 caracteres: la paquetería lo rechazaría');
  perform tests.eq((select shipping_address from public.company_settings where id = 'default'), 'Nuevo Mundo 1045', '3 · tras los rechazos la línea sigue intacta');

  -- ══ 4 · permisos: Ventas no escribe (política existente) ════════════════════════════════════════
  perform tests.act_as(v_pos);
  update public.company_settings set shipping_colonia = 'Otra' where id = 'default';
  perform tests.ok((select shipping_colonia from public.company_settings where id = 'default') = 'Las Quintas', '4 · Ventas no modifica el origen (RLS de Dirección)');
  perform tests.act_as_owner();
end $t$;
rollback;
