-- EVENTOS CON EQUIPO (20270313) · solo Almacén crea eventos; Alberto arma el equipo (de cualquier puesto); el equipo ve el
-- evento y vende en él; el auxiliar que no va no lo ve; Dirección ve todo y no crea eventos; Almacén cierra.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); w uuid := tests.fixture_almacen(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos');
  b1 uuid := tests.user('packing'); b2 uuid := tests.user('packing'); d1 uuid := tests.user('doctor'); ev uuid := gen_random_uuid(); ok boolean; n int; r jsonb;
begin
  -- ══ 1 · crear ══
  perform tests.act_as(v_admin);
  begin perform public.abrir_custodia(gen_random_uuid(), 'evento', 'staff', s1, null, 'Expo Dirección', null, null); ok := false; exception when others then ok := sqlerrm like 'NO_AUTORIZADO%'; end;
  perform tests.ok(ok, '1 · Dirección ya no crea eventos');
  perform tests.act_as(w);
  perform public.abrir_custodia(ev, 'evento', 'staff', s1, null, 'Expo Culiacán', 'Centro de convenciones', current_date);
  perform tests.ok(exists (select 1 from public.custodies where id = ev and kind = 'evento'), '1 · Almacén crea el evento');

  -- ══ 2 · equipo ══
  perform tests.act_as(s1);
  begin perform public.evento_equipo_guardar(ev, array[b1]); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '2 · solo Almacén arma el equipo');
  perform tests.act_as(w);
  begin perform public.evento_equipo_guardar(ev, array[d1]); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '2 · un doctor no va a un evento');
  r := public.evento_equipo_guardar(ev, array[b1, w]);
  perform tests.ok((r ->> 'miembros')::int = 3, '2 · responsable + auxiliar + Alberto');

  -- ══ 3 · quién ve el evento ══
  perform tests.act_as(b1); select count(*) into n from public.custodies where id = ev; perform tests.ok(n = 1, '3 · el auxiliar del equipo lo ve');
  perform tests.act_as(b2); select count(*) into n from public.custodies where id = ev; perform tests.ok(n = 0, '3 · el auxiliar que no va no lo ve');
  perform tests.act_as(s2); select count(*) into n from public.custodies where id = ev; perform tests.ok(n = 0, '3 · otro vendedor no lo ve');
  perform tests.act_as(v_admin); select count(*) into n from public.custodies where id = ev; perform tests.ok(n = 1, '3 · Dirección ve todo');
  perform tests.act_as(b1); perform tests.ok(public.estado_custodia(ev) is not null, '3 · el equipo ve su estado');
  perform tests.act_as(b2);
  begin perform public.estado_custodia(ev); ok := false; exception when others then ok := sqlerrm like 'NO_AUTORIZADO%'; end;
  perform tests.ok(ok, '3 · fuera del equipo no ve su estado');

  -- ══ 4 · vender en el evento: el equipo, aunque no sea vendedor ══
  perform tests.ok(public._evento_es_miembro(ev, b1) and public._evento_es_miembro(ev, s1) and not public._evento_es_miembro(ev, b2), '4 · el equipo puede vender; los demás no');
  perform tests.act_as(b2);
  begin perform public.vender_pos(gen_random_uuid(), 'EV-1', 100, 'efectivo', null, null, '[]', '[]', false, null, null, 100, ev); ok := false; exception when others then ok := sqlerrm = 'No autorizado'; end;
  perform tests.ok(ok, '4 · el auxiliar fuera del equipo no vende');
  perform tests.act_as(b1);
  begin perform public.vender_pos(gen_random_uuid(), 'EV-2', 100, 'efectivo', null, null, '[]', '[]', false, null, null, 100, ev); ok := true; exception when others then ok := sqlerrm <> 'No autorizado' and sqlerrm not like 'NO_AUTORIZADO%'; end;
  perform tests.ok(ok, '4 · el auxiliar del equipo pasa la autorización (lo demás lo valida la venta)');

  -- ══ 5 · cerrar: Almacén ══
  perform tests.act_as(w);
  r := public.cerrar_custodia(gen_random_uuid(), ev, 'evento terminado');
  perform tests.ok(exists (select 1 from public.custodies where id = ev and status = 'cerrada'), '5 · Almacén cierra el evento');
end $t$;
rollback;
