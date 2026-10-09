-- W6-A1 · Suspensión de personal con autoridad en el servidor.
--
-- Lo que se demuestra: el personal ACTIVO conserva exactamente su autoridad; el
-- SUSPENDIDO la pierde en todo lo que depende de auth_role() (RLS, comandos W1–W5,
-- kpi_*, conciliar_*), sin atajos por has_cap/is_verified; service_role y cron no
-- cambian; los comandos tienen la autoridad y los límites diseñados; nada se borra.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_admin2 uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos'); v_drv uuid := tests.user('driver');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product(100); v_l uuid; v_o uuid; v_r jsonb;
  r record; n_owner bigint; n_tablas int := 0; n_protegidas int := 0; n_audit_antes int;
begin
  v_l := tests.stock(v_p, 'W6A-1', 20);
  v_o := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)), 'paid');
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}'::jsonb) || '{"capabilities": ["diseno"]}'::jsonb where id = v_wh;
  perform tests.act_as_owner();

  -- ══ 1) Personal ACTIVO: la misma autoridad de siempre ═════════════════════
  perform tests.act_as(v_admin2);
  perform tests.ok(public.auth_role() = 'admin' and (public.kpi_ventas() ? 'ventas') and (select count(*) from public.conciliar_inventario() c) >= 0,
    'Dirección activa: rol, indicadores y conciliación');
  perform tests.act_as(v_bill);
  perform tests.ok(public.auth_role() = 'billing' and (public.kpi_ventas() ? 'ventas') and (select count(*) from public.payment_entries) >= 1,
    'Facturación activa: rol, ventas y libro');
  perform tests.act_as(v_wh);
  perform tests.ok(public.auth_role() = 'warehouse' and public.has_cap('diseno') and (select count(*) from public.lots) >= 1,
    'Almacén activo: rol, capacidad y lotes');
  perform tests.act_as(v_pos);
  -- SEC-C1 (140): el POS arquea SU corte de cajero (el del día ya no)
  perform tests.ok(public.auth_role() = 'pos' and public.efectivo_esperado(public.hoy_local(), 'cajero', v_pos) >= 0, 'POS activo: rol y efectivo esperado');
  perform tests.act_as(v_drv);
  perform tests.ok(public.auth_role() = 'driver' and public.is_verified(), 'Chofer activo: rol y verificado');
  perform tests.act_as(v_doc);
  perform tests.ok(public.auth_role() = 'doctor' and public.is_verified() and (select count(*) from public.orders where doctor_id = v_doc) = 1,
    'Doctor verificado: rol y sus pedidos');
  perform tests.act_as_owner();

  -- ══ 2) Comandos: autoridad y límites ══════════════════════════════════════
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.suspender_staff(%L, ''x'')', v_wh), 'NO_AUTORIZADO', 'Facturación no suspende');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.suspender_staff(%L, ''x'')', v_pos), 'NO_AUTORIZADO', 'Almacén no suspende');
  perform tests.throws(format('select public.reactivar_staff(%L)', v_pos), 'NO_AUTORIZADO', 'Almacén no reactiva');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.suspender_staff(%L, ''x'')', v_wh), 'permission denied', 'anónimo no ejecuta el comando');
  perform tests.act_as(v_admin2);
  perform tests.throws(format('select public.suspender_staff(%L, ''x'')', v_admin2), 'AUTOSUSPENSION_PROHIBIDA', 'Dirección no se suspende a sí misma');
  perform tests.throws(format('select public.reactivar_staff(%L)', v_admin2), 'AUTOSUSPENSION_PROHIBIDA', 'ni se reactiva a sí misma');
  perform tests.throws(format('select public.suspender_staff(%L, ''x'')', v_doc), 'SOLO_STAFF', 'un doctor no se suspende por aquí');
  perform tests.throws(format('select public.suspender_staff(%L, ''x'')', gen_random_uuid()), 'STAFF_INEXISTENTE', 'usuario inexistente');
  perform tests.throws(format('select public.suspender_staff(%L, ''  '')', v_wh), 'MOTIVO_REQUERIDO', 'el motivo es obligatorio');
  perform tests.throws(format('update public.profiles set active = false where id = %L', v_wh), 'ACCESO_SOLO_POR_COMANDO', 'ni Dirección edita active a mano');
  perform tests.throws(format('update public.profiles set role_id = ''admin'' where id = %L', v_wh), 'ROL_SOLO_POR_COMANDO', 'ni role_id a mano');
  perform tests.lives(format('update public.profiles set meta = meta || ''{"x": 1}'' where id = %L', v_wh), 'Dirección sigue editando meta (capacidades, nombre)');
  perform tests.act_as(v_wh);
  perform tests.throws(format('update public.profiles set active = false where id = %L', v_wh), 'ACCESO_SOLO_POR_COMANDO', 'el propio usuario tampoco toca active');
  perform tests.act_as_service();
  perform tests.lives(format('update public.profiles set role_id = ''packing'' where id = %L', v_pos), 'service_role (staff-admin) sí cambia el rol');
  perform tests.lives(format('update public.profiles set role_id = ''pos'' where id = %L', v_pos), 'y lo regresa');
  perform tests.act_as_owner();

  -- ══ 3) Suspender: desde ese instante, sin autoridad ═══════════════════════
  select count(*) into n_audit_antes from public.audit_logs;
  perform tests.act_as(v_admin2);
  v_r := public.suspender_staff(v_wh, 'prueba de suspensión');
  perform tests.eq(v_r ->> 'status', 'applied', 'suspender aplica');
  perform tests.eq(public.suspender_staff(v_wh, 'otra vez') ->> 'status', 'already_applied', 'suspender es idempotente');
  perform tests.act_as_owner();
  perform tests.ok((select not active and meta ? 'suspension' and not (meta ? 'active') from public.profiles where id = v_wh),
    'active=false, marca de suspensión y la llave vieja de JSON desaparece');
  perform tests.eq((select count(*)::int from public.audit_logs where actor = v_admin2 and action = 'Acceso suspendido' and resource_id = v_wh::text), 1,
    'bitácora: quién suspendió a quién');

  perform tests.act_as(v_wh);
  perform tests.throws('select public.auth_role()', 'CUENTA_SUSPENDIDA', 'auth_role() falla cerrado para el suspendido');
  perform tests.eq(public.has_cap('diseno'), false, 'has_cap no es atajo: false aunque tenga la capacidad');
  perform tests.eq(public.is_verified(), false, 'is_verified no es atajo');

  -- 3a) RLS: toda tabla cuya LECTURA depende de auth_role() (sin ninguna política de
  --     lectura pública o "solo mis filas") y tiene filas → el suspendido no la lee:
  --     la consulta lanza CUENTA_SUSPENDIDA.
  for r in select t.tablename from (select distinct tablename from pg_policies where schemaname = 'public') t
            where exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
                             and p.cmd in ('SELECT', 'ALL') and p.qual ilike '%auth_role()%')
              and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
                                 and p.cmd in ('SELECT', 'ALL') and coalesce(p.qual, '') not ilike '%auth_role()%')
            order by 1 loop
    n_tablas := n_tablas + 1;
    perform tests.act_as_owner();
    execute format('select count(*) from public.%I', r.tablename) into n_owner;
    if n_owner = 0 then continue; end if;
    n_protegidas := n_protegidas + 1;
    perform tests.act_as(v_wh);
    begin
      execute format('select count(*) from public.%I', r.tablename);
      raise exception 'FAIL: el suspendido leyó %', r.tablename;
    exception when insufficient_privilege then
      if position('CUENTA_SUSPENDIDA' in sqlerrm) = 0 then raise; end if;
    end;
  end loop;
  perform tests.act_as_owner();
  perform tests.ok(n_tablas >= 25 and n_protegidas >= 8,
    format('RLS: %s tablas cuya lectura depende de auth_role(), %s con filas, ninguna legible por el suspendido', n_tablas, n_protegidas));

  -- 3b) Escrituras protegidas
  perform tests.act_as(v_wh);
  perform tests.throws_any('insert into public.expenses (fecha, categoria, concepto, monto) values (current_date, ''Otros'', ''x'', 1)',
    array['CUENTA_SUSPENDIDA', 'permission denied'], 'INSERT protegido negado');
  perform tests.throws_any(format('update public.orders set status = ''cancelled'' where id = %L', v_o),
    array['CUENTA_SUSPENDIDA', 'permission denied'], 'UPDATE protegido negado');
  perform tests.act_as_owner();
  insert into public.expenses (fecha, categoria, concepto, monto) values (current_date, 'Otros', 'gasto protegido', 1);
  perform tests.act_as(v_wh);
  perform tests.throws_any('delete from public.expenses where concepto = ''gasto protegido''',
    array['CUENTA_SUSPENDIDA', 'permission denied'], 'DELETE protegido negado');
  perform tests.throws_any(format('update public.profiles set meta = meta || ''{"y": 1}'' where id = %L', v_wh),
    array['CUENTA_SUSPENDIDA', 'permission denied'], 'ni su propio perfil');

  -- 3c) Comandos W1–W5, indicadores y conciliaciones
  perform tests.throws(format('select public.recibir_lote(gen_random_uuid(), %L, ''W6A-2'', current_date + 365, 1, null, ''sin_orden'', 10, ''x'', null)', v_p), 'CUENTA_SUSPENDIDA', 'W1 recibir_lote');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, ''[]''::jsonb)', v_o), 'CUENTA_SUSPENDIDA', 'W1 surtir_pedido');
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'CUENTA_SUSPENDIDA', 'W1 cancelar_pedido');
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, -1, ''merma'', ''x'')', v_l), 'CUENTA_SUSPENDIDA', 'W1 ajustar_lote');
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', 1)', v_o), 'CUENTA_SUSPENDIDA', 'W2 registrar_cobro');
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, current_date + 10, ''x'')', v_o), 'CUENTA_SUSPENDIDA', 'W2 autorizar_credito');
  perform tests.throws('select public.efectivo_esperado(public.hoy_local())', 'CUENTA_SUSPENDIDA', 'W2 efectivo_esperado');
  perform tests.throws('select public.abrir_custodia(gen_random_uuid(), ''vendedor'', ''staff'', gen_random_uuid(), null, null)', 'CUENTA_SUSPENDIDA', 'W2-C abrir_custodia');
  perform tests.throws(format('select public.solicitar_cfdi(gen_random_uuid(), %L, tests.fiscal())', v_o), 'CUENTA_SUSPENDIDA', 'W3 solicitar_cfdi');
  perform tests.throws(format('select public.validar_fiscal_producto(gen_random_uuid(), %L, ''contador'')', v_p), 'CUENTA_SUSPENDIDA', 'W3-C validar_fiscal_producto');
  perform tests.throws('select public.estado_validacion_fiscal()', 'CUENTA_SUSPENDIDA', 'W3-C estado_validacion_fiscal');
  perform tests.throws('select public.comm_reclamar(1)', 'CUENTA_SUSPENDIDA', 'W4 comm_reclamar');
  perform tests.throws('select public.kpi_ventas()', 'CUENTA_SUSPENDIDA', 'W5 kpi_ventas');
  perform tests.throws('select public.kpi_por_cobrar()', 'CUENTA_SUSPENDIDA', 'W5 kpi_por_cobrar');
  perform tests.throws('select public.kpi_resultado()', 'CUENTA_SUSPENDIDA', 'W5 kpi_resultado');
  perform tests.throws('select count(*) from public.conciliar_inventario()', 'CUENTA_SUSPENDIDA', 'conciliar_inventario');
  perform tests.throws('select count(*) from public.conciliar_dinero()', 'CUENTA_SUSPENDIDA', 'conciliar_dinero');
  perform tests.throws('select count(*) from public.conciliar_custodia()', 'CUENTA_SUSPENDIDA', 'conciliar_custodia');
  perform tests.throws('select count(*) from public.conciliar_cfdi()', 'CUENTA_SUSPENDIDA', 'conciliar_cfdi');
  perform tests.throws('select public.log_audit(''x'', ''y'', ''z'', ''w'')', 'CUENTA_SUSPENDIDA', 'ni escribir en la bitácora');
  perform tests.throws(format('select public.suspender_staff(%L, ''x'')', v_pos), 'CUENTA_SUSPENDIDA', 'un admin suspendido tampoco suspende a otros');

  -- 3d) Un admin suspendido pierde la autoridad de Dirección (no es un rol especial)
  perform tests.act_as(v_admin);
  v_r := public.suspender_staff(v_admin2, 'prueba admin');
  perform tests.act_as(v_admin2);
  perform tests.throws('select public.kpi_resultado()', 'CUENTA_SUSPENDIDA', 'Dirección suspendida: sin indicadores');
  perform tests.throws(format('select public.reactivar_staff(%L)', v_wh), 'CUENTA_SUSPENDIDA', 'Dirección suspendida: no reactiva a nadie');
  perform tests.act_as(v_admin);
  perform tests.eq(public.reactivar_staff(v_admin2) ->> 'status', 'applied', 'otra Dirección la reactiva');

  -- ══ 4) service_role y cron: intactos ══════════════════════════════════════
  perform tests.act_as_service();
  perform tests.eq(public.auth_role(), '', 'service_role: auth_role() sigue siendo vacío');
  perform tests.lives('select tests.user(''pos'')', 'service_role sigue creando usuarios');
  perform tests.act_as_owner();
  perform tests.eq(public.auth_role(), '', 'cron/owner sin claims: vacío, como siempre');
  perform tests.lives('select public.avisar_lotes_por_caducar()', 'el aviso diario de lotes corre igual');

  -- ══ 5) Reactivar restaura; la historia se conserva ════════════════════════
  perform tests.act_as(v_admin2);
  perform tests.eq(public.reactivar_staff(v_wh) ->> 'status', 'applied', 'reactivar aplica');
  perform tests.eq(public.reactivar_staff(v_wh) ->> 'status', 'already_applied', 'reactivar es idempotente');
  perform tests.act_as(v_wh);
  perform tests.ok(public.auth_role() = 'warehouse' and public.has_cap('diseno') and (select count(*) from public.lots) >= 1,
    'reactivado: rol, capacidad y lecturas de vuelta');
  perform tests.lives(format('select public.ajustar_lote(gen_random_uuid(), %L, -1, ''merma'', ''frasco roto'')', v_l), 'reactivado: vuelve a operar (W1)');
  perform tests.act_as_owner();
  perform tests.ok((select active and (meta -> 'suspension') ? 'reactivada_at' from public.profiles where id = v_wh),
    'la marca de la suspensión se conserva con su reactivación');
  perform tests.eq((select count(*)::int from public.audit_logs) - n_audit_antes, 4,
    'bitácora: suspensión, suspensión de admin, reactivación de admin, reactivación');

  -- ══ 6) Baja = suspensión marcada; nada se borra ═══════════════════════════
  perform tests.act_as(v_admin2);
  v_r := public.suspender_staff(v_pos, 'dejó la empresa', true);
  perform tests.eq((v_r ->> 'baja')::boolean, true, 'baja aplica como suspensión');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.profiles where id = v_pos) = 1 and (select count(*) from auth.users where id = v_pos) = 1,
    'baja: el perfil y la cuenta siguen existiendo');
  perform tests.ok((select not active and (meta -> 'baja' ->> 'motivo') = 'dejó la empresa' from public.profiles where id = v_pos), 'baja: marca informativa');
  perform tests.eq((select action from public.audit_logs where resource_id = v_pos::text order by created_at desc limit 1), 'Baja de personal', 'bitácora de la baja');
  perform tests.act_as(v_pos);
  perform tests.throws('select public.auth_role()', 'CUENTA_SUSPENDIDA', 'dado de baja: sin autoridad');
  perform tests.act_as(v_admin2);
  perform tests.eq(public.reactivar_staff(v_pos) ->> 'status', 'applied', 'una baja se puede revertir (Dirección decide)');
  perform tests.act_as_owner();
  perform tests.ok((select active and not (meta ? 'baja') from public.profiles where id = v_pos), 'al reactivar, la marca de baja se retira');

  -- ══ 7) Trazabilidad: lo que hizo un empleado sigue apuntando a él ═════════
  perform tests.act_as(v_admin2);
  perform public.suspender_staff(v_wh, 'x', true);
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.audit_logs where actor = v_admin2) and exists (select 1 from public.profiles where id = v_wh),
    'actores de la bitácora resolubles tras la baja');
end $t$;
rollback;
