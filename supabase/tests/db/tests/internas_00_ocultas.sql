-- CUENTAS INTERNAS · una cuenta interna no existe para el resto del equipo (no se lista, no se lee, no se edita, no se
-- borra), no entra al reparto ni a los conteos de vendedores, y la marca solo la cambia el servidor. Las internas se ven
-- entre sí y conservan sus permisos.
begin;
do $t$
declare
  v_adm uuid := tests.user('admin'); v_ven uuid := tests.user('pos'); v_alm uuid := tests.user('warehouse'); v_cho uuid := tests.user('driver');
  i_adm uuid := tests.user('admin'); i_ven uuid := tests.user('pos'); i_cho uuid := tests.user('driver');
  n int; r jsonb; x uuid; vistos uuid[] := '{}';
begin
  perform tests.act_as_service();
  update public.profiles set meta = jsonb_build_object('capabilities', jsonb_build_array('conversaciones', 'nuevos_clientes')) where id in (v_ven, i_ven);
  update public.profiles set interna = true where id in (i_adm, i_ven, i_cho);

  -- ══ 1 · Dirección normal no ve las internas ════════════════════════════════════════════════════
  perform tests.act_as(v_adm);
  perform tests.eq((select count(*)::int from public.profiles where id in (i_adm, i_ven, i_cho)), 0, '1.1 · Dirección no lee ninguna cuenta interna');
  perform tests.eq((select count(*)::int from public.profiles where id in (v_ven, v_alm, v_cho)), 3, '1.2 · y sí ve al resto del equipo');
  update public.profiles set full_name = 'X' where id = i_ven;
  get diagnostics n = row_count;
  perform tests.eq(n, 0, '1.3 · no puede editar una cuenta interna aunque sepa su id');
  delete from public.profiles where id = i_cho;
  get diagnostics n = row_count;
  perform tests.eq(n, 0, '1.4 · ni borrarla');
  r := public.cc_vendedores();
  perform tests.ok(r @> jsonb_build_array(jsonb_build_object('id', v_ven)) and not r @> jsonb_build_array(jsonb_build_object('id', i_ven)), '1.5 · la lista de vendedores no la muestra');
  perform tests.eq((public.cc_ruteo_resumen() ->> 'vendedores_elegibles')::int, 1, '1.6 · el resumen de ruteo no la cuenta');
  perform tests.eq((public.cc_ruteo_resumen() ->> 'vendedores_elegibles_nuevos')::int, 1, '1.7 · ni entre los de clientes nuevos');
  perform tests.eq((public.cc_atencion_config_ver() -> 'reparto' ->> 'vendedores_elegibles')::int, 1, '1.8 · la configuración de reparto tampoco');

  -- ══ 2 · el resto del equipo tampoco (choferes) ════════════════════════════════════════════════
  perform tests.act_as(v_alm);
  perform tests.ok((select count(*) = 1 from public.profiles where id = v_cho) and not exists (select 1 from public.profiles where id = i_cho), '2.1 · Almacén ve al chofer real y no al chofer interno');

  -- ══ 3 · la marca solo la cambia el servidor ════════════════════════════════════════════════════
  perform tests.act_as(v_adm);
  perform tests.throws(format('update public.profiles set interna = true where id = %L', v_adm), 'INTERNA_SOLO_SERVIDOR', '3.1 · Dirección no puede ocultarse a sí misma');
  perform tests.throws(format('update public.profiles set interna = true where id = %L', v_ven), 'INTERNA_SOLO_SERVIDOR', '3.2 · ni ocultar a otro');
  perform tests.act_as(i_adm);
  update public.profiles set interna = false where id = i_ven;
  get diagnostics n = row_count;
  perform tests.eq(n, 0, '3.3 · una interna no destapa a otra desde la app (ni siquiera la ve)');
  perform tests.throws(format('update public.profiles set interna = false where id = %L', i_adm), 'INTERNA_SOLO_SERVIDOR', '3.4 · ni a sí misma');

  -- ══ 4 · las internas se ven entre sí y conservan sus permisos ══════════════════════════════════
  perform tests.eq((select count(*)::int from public.profiles where id in (i_adm, i_ven, i_cho, v_ven, v_adm)), 3, '4.1 · la interna de Dirección ve al equipo y a sí misma, pero no a las otras internas (INTERNAS-2)');
  r := public.cc_vendedores();
  perform tests.ok(not r @> jsonb_build_array(jsonb_build_object('id', i_ven)) and r @> jsonb_build_array(jsonb_build_object('id', v_ven)), '4.2 · y su lista de vendedores tampoco las muestra');
  perform tests.act_as(i_ven);
  perform tests.ok(exists (select 1 from public.profiles where id = i_ven), '4.3 · cada interna se ve a sí misma');
  update public.profiles set full_name = 'Otro nombre' where id = i_adm;
  get diagnostics n = row_count;
  perform tests.eq(n, 0, '4.4 · ni una interna edita a otra interna');

  -- ══ 5 · el reparto nunca manda un cliente real a una interna ══════════════════════════════════
  perform tests.act_as_owner();
  for k in 1..40 loop x := public._cc_reparto_elegir(gen_random_uuid()); vistos := vistos || x; end loop;
  perform tests.ok(v_ven = any (vistos) and not (i_ven = any (vistos)), '5.1 · 40 repartos: siempre el vendedor real, nunca la cuenta interna');
  perform tests.ok(public._cc_vendedor_elegible(i_ven, true), '5.2 · la interna sigue siendo vendedora válida para su propia cartera (pruebas del dueño)');
end $t$;
rollback;
