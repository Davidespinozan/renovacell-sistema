-- BOT DETECTADO · el down devuelve EXACTAMENTE lo anterior (funciones y CHECK de eventos), se reaplica idéntico, y se niega si
-- la bitácora ya tiene eventos 'bot_detectado'.
begin;
create temp table _bot as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_ccce_tipo') as ck;
\ir ../../../rollback/bot_detectado/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_bot_detectado(uuid,text)') is null and position('bot_detectado' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_ccce_tipo')) = 0
                   and position('''bot''' in pg_get_functiondef('public.cc_canal_conversacion(uuid)'::regprocedure)) = 0, 'BOT down · sin función, sin tipo y canal sin `bot`');
end $t$;
\ir ../../../migrations/20270331120000_bot_detectado.sql
do $t$ begin
  perform tests.ok((select todas from _bot) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
                   and (select ck from _bot) = (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_ccce_tipo'), 'BOT · se reaplica idéntica');
end $t$;
-- con un evento en la bitácora, el down se niega
do $t$ declare c uuid; begin
  perform tests.act_as_service();
  c := (public.cc_wa_entrante('5218009990000', null, 'wamid.BOTRB0001', 'Envió un mensaje por WhatsApp.', false) ->> 'conversation_id')::uuid;
  perform public.cc_bot_detectado(c, 'numero_empresa');
  perform tests.act_as_owner();
end $t$;
\set ON_ERROR_STOP 0
savepoint antes;
\ir ../../../rollback/bot_detectado/99_down.sql
rollback to savepoint antes;
\set ON_ERROR_STOP 1
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_bot_detectado(uuid,text)') is not null, 'BOT down · se niega con eventos en la bitácora');
end $t$;
rollback;
