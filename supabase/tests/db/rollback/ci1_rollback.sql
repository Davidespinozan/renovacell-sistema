-- Commercial Intent CI-1 (128) · El down restaura EXACTAMENTE las funciones de la 127 (CC-7 "un ciclo por
-- carrito"), retira _cc_episodio_vivo y cc_carts.handoff_session_id, sin tocar mensajes, sesiones ni eventos.
begin;
create temp table _ci1_antes as select (select count(*) from public.cc_conversation_sessions) s, (select count(*) from public.cc_conversation_events) e, (select count(*) from public.cc_messages) m, (select count(*) from public.cc_carts) k;
\ir ../../../rollback/cartera_p1/99_down.sql   -- CARTERA-P1 (131) se baja primero
\ir ../../../rollback/chatv2d1/99_down.sql   -- CHAT V2-D1 (130) se baja primero
\ir ../../../rollback/ci1/99_down.sql
do $t$
begin
  perform tests.ok(to_regprocedure('public._cc_episodio_vivo(uuid)') is null, '128 down · _cc_episodio_vivo retirada');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'cc_carts' and column_name = 'handoff_session_id'), '128 down · columna retirada');
  perform tests.ok(position('Un ciclo por carrito' in pg_get_functiondef('public._cc_cart_mutar(uuid,text,text,uuid,text,uuid,integer,text)'::regprocedure)) > 0, '128 down · regla CC-7 restaurada');
  perform tests.ok(position('''sys:handoff:'' || p_cart::text)' in pg_get_functiondef('public._cc_handoff_carrito(uuid)'::regprocedure)) > 0, '128 down · aviso de CC-7 restaurado');
  perform tests.ok(to_regclass('public.cc_conversation_sessions') is not null and to_regprocedure('public._cc_sesion_mensaje()') is not null, '128 down · C1/C2 intactos');
  perform tests.ok((select s = (select count(*) from public.cc_conversation_sessions) and e = (select count(*) from public.cc_conversation_events)
                           and m = (select count(*) from public.cc_messages) and k = (select count(*) from public.cc_carts) from _ci1_antes), '128 down · sin cambios de datos');
end $t$;
rollback;
