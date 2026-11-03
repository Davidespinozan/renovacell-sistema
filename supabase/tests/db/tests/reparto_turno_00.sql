-- REPARTO POR TURNO (20270312) · 1 y 1 entre vendedores (nunca una cuenta interna), la verificación por WhatsApp va a un
-- vendedor por turno (no a Dirección) y Almacén/Ventas administran promociones; un vendedor solo difunde a su cartera.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); si uuid := tests.user('pos'); w1 uuid := tests.user('warehouse'); d1 uuid := tests.user('doctor');
  r jsonb; c1 uuid; c2 uuid; a uuid; b uuid; x uuid; y uuid; ok boolean;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2, si);
  update public.profiles set interna = true where id = si;
  -- solo estos tres vendedores cuentan en esta prueba
  update public.profiles set active = false where role_id = 'pos' and id not in (s1, s2, si);

  -- ══ 1 · turno estricto, sin cuentas internas ══
  perform tests.act_as_service();
  a := public._cc_vendedor_turno('{}'); b := public._cc_vendedor_turno('{}'); x := public._cc_vendedor_turno('{}'); y := public._cc_vendedor_turno('{}');
  perform tests.ok(a <> b and x = a and y = b, '1 · 1 y 1: A, B, A, B');
  perform tests.ok(si not in (a, b), '1 · nunca a una cuenta interna');
  perform tests.ok(public._cc_vendedor_azar('{}') is not null and public._cc_vendedor_turno(array[a, b]) is null, '1 · el nombre de siempre también va por turno; excluidos todos: nadie');

  -- ══ 2 · verificación por WhatsApp: a un vendedor por turno, no a Dirección ══
  r := public.cc_wa_entrante('5216670003333', 'Dra Uno', 'wamid.RT.1', 'quiero precios', false); c1 := (r ->> 'conversation_id')::uuid;
  r := public.cc_wa_entrante('5216670004444', 'Dra Dos', 'wamid.RT.2', 'quiero precios', false); c2 := (r ->> 'conversation_id')::uuid;
  perform public.cc_ia_solicitar_alta(c1, 'Ana Uno Pérez', '12345678', 'ana1@prueba.mx', null, null);
  perform public.cc_ia_solicitar_alta(c2, 'Bea Dos López', '87654321', 'bea2@prueba.mx', null, null);
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id from public.cc_conversations where id = c1) is distinct from (select seller_profile_id from public.cc_conversations where id = c2)
               and (select seller_profile_id from public.cc_conversations where id = c1) in (s1, s2) and (select seller_profile_id from public.cc_conversations where id = c2) in (s1, s2), '2 · cada verificación a un vendedor distinto (turno)');
  perform tests.ok(not exists (select 1 from public.notifications where kind = 'verificacion_wa' and roles @> array['admin']), '2 · Dirección no recibe la verificación');
  perform tests.ok((select modo from public.cc_conversations where id = c1) not in ('human_assigned', 'human_active'), '2 · la IA sigue atendiendo (no cambia el modo)');
  perform tests.ok(public._cc_responsable_comercial(c1) = (select seller_profile_id from public.cc_conversations where id = c1), '2 · ese vendedor queda como responsable de los siguientes avisos');

  -- ══ 3 · promociones ══
  perform tests.act_as(w1); perform tests.ok(public._promo_puede_administrar(), '3 · Almacén administra promociones y flyers');
  perform tests.act_as(s1); perform tests.ok(public._promo_puede_administrar() and public._promo_puede_difundir(s1) and not public._promo_puede_difundir(null) and not public._promo_puede_difundir(s2), '3 · el vendedor administra y solo difunde a SU cartera');
  perform tests.act_as(v_admin); perform tests.ok(public._promo_puede_difundir(null), '3 · Dirección difunde a todos');
  perform tests.act_as(d1); perform tests.ok(not public._promo_puede_administrar(), '3 · un doctor no');
  perform tests.act_as_owner();
  perform tests.ok(position('_promo_puede_difundir(p_vendedor)' in pg_get_functiondef('public.promocion_difundir(uuid,text[],uuid)'::regprocedure)) > 0, '3 · el envío usa la regla nueva');
end $t$;
rollback;
