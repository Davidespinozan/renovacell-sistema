-- CHV2-A (123) · El rollback restaura las funciones de 122 y retira configuración/evaluador/columnas; no borra
-- conversaciones, mensajes, eventos, cartera ni las notificaciones ya emitidas.
begin;
do $t$
declare s1 uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); p uuid; k uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  perform tests.cliente(d1); insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  p := tests.producto_cat('Rellenos', 100); perform tests.stock(p, 'RB-A', 10);
  k := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(k, 'doctor', null, d1, p, 1, 'rb-1');
  perform tests.act_as_owner();
  create temp table chv2a_antes on commit drop as
    select (select count(*) from public.cc_conversations) convs, (select count(*) from public.cc_messages) msgs, (select count(*) from public.cc_conversation_events) evs,
           (select count(*) from public.cc_cartera) cartera, (select count(*) from public.notifications) notifs;
end $t$;
reset role;
select set_config('request.jwt.claims', '', true);
set app.chatv2c1_rollback_forzado = 'on';   -- prueba estructural de la cadena completa (la frontera se prueba en chatv2c1_rollback.sql)
\ir ../../../rollback/cartera_p1/99_down.sql   -- CARTERA-P1 (131) se baja primero
\ir ../../../rollback/chatv2d1/99_down.sql   -- CHAT V2-D1 (130) se baja primero
\ir ../../../rollback/ci1/99_down.sql   -- Commercial Intent CI-1 (128) se baja primero
\ir ../../../rollback/chatv2c2/99_down.sql   -- Chat V2-C2 (127) se baja primero
\ir ../../../rollback/chatv2c1/99_down.sql   -- Chat V2-C1 (125) se baja primero
\ir ../../../rollback/chv2a_cron/99_down.sql   -- CHV2-A cron fix (124) se baja primero
\ir ../../../rollback/chv2a/99_down.sql
do $t$
declare a record;
begin
  select * into a from chv2a_antes;
  perform tests.ok(to_regclass('public.cc_atencion_config') is null and to_regclass('public.cc_atencion_config_hist') is null, 'configuración retirada');
  perform tests.ok(to_regprocedure('public.cc_solicitud_reasignar(uuid,uuid,text)') is null and to_regprocedure('public.cc_atencion_evaluar()') is null and to_regprocedure('public._cc_atencion(uuid)') is null
               and to_regprocedure('public._cc_minutos_habiles(timestamptz,timestamptz)') is null and to_regprocedure('public._cc_notificar(text,uuid,uuid[],text[],text,text,text)') is null, 'funciones nuevas retiradas');
  perform tests.ok(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure) !~ '_cc_notificar' and pg_get_functiondef('public.cc_asignar_asesor(uuid,uuid,uuid)'::regprocedure) !~ '_cc_handler_asignar', 'ruteo y asignación vuelven al texto de 122');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'notifications' and column_name in ('kind', 'conversation_id', 'event_key')), 'columnas de notifications retiradas');
  perform tests.ok(exists (select 1 from pg_proc where proname = 'cc_cola_asesorias') and pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure) !~ '_cc_atencion', 'cola sin la columna derivada');
  perform tests.eq((select count(*) from public.cc_conversations), a.convs, 'conversaciones intactas');
  perform tests.eq((select count(*) from public.cc_messages), a.msgs, 'mensajes intactos');
  perform tests.eq((select count(*) from public.cc_conversation_events), a.evs, 'eventos intactos');
  perform tests.eq((select count(*) from public.cc_cartera), a.cartera, 'cartera intacta');
  perform tests.eq((select count(*) from public.notifications), a.notifs, 'notificaciones conservadas');
end $t$;
rollback;
