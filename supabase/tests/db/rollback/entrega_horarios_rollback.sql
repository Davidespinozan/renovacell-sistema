-- HORARIO DE ENTREGA LOCAL (ENT-H, 189) · el down retira la agenda y los campos horario_* y vuelven las funciones de la 171;
-- se reaplica idéntica. Con reservas de horario registradas, el down se niega (no destruye información).
begin;
\ir ../../../rollback/mayoreo_reglas/99_down.sql   -- MAYOREO-REGLAS (20270222) redefine precio y cobro: se baja antes de la foto inicial
create temp table _enth as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
\ir ../../../rollback/entrega_paridad/99_down.sql   -- ENT-P se baja antes que ENT-H (redefine _entrega_normalizar)
\ir ../../../rollback/entrega_horarios/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.entrega_horarios') is null and to_regprocedure('public.entrega_horarios_disponibles(timestamptz)') is null
               and to_regprocedure('public.entrega_horarios_agenda(date,date)') is null and to_regprocedure('public.entrega_horario_reprogramar(uuid,text,text,text)') is null
               and not exists (select 1 from information_schema.columns where table_name = 'entrega_config' and column_name like 'horario_%')
               and not exists (select 1 from pg_trigger where tgname = 'orders_entrega_horario_liberar')
               and md5(pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure)) = '13545a870c138acf7ca42f37601f91a6'
               and md5(pg_get_functiondef('public._entrega_aplicar(uuid,jsonb)'::regprocedure)) = 'a43d00fde28d523d0592ec5e69945eef'
               and md5(pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb,jsonb)'::regprocedure)) = 'f98ff78b8a1c3e878c82f39455c61bf1'
               and md5(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)'::regprocedure)) = '10a47072077ba2c8d77702b5e2de7648'
               and md5(pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure)) = '29fae3bc5f34070f96f00c4b5d97aea9'
               and to_regclass('public.entrega_config') is not null and to_regprocedure('public.crear_pedido_con_entrega(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb,jsonb)') is not null
               and (select n_tablas from _enth) = (select count(*) + 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'),
    '189 down · sin agenda ni horarios; normalizar/aplicar/checkout/guardar como en la 171; la 171 intacta');
end $t$;
\ir ../../../migrations/20270111120000_entrega_horarios.sql
\ir ../../../migrations/20270128120000_entrega_paridad.sql   -- ENT-P se reaplica encima de la 189
do $t$ begin
  perform tests.ok((select todas from _enth) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '189 · se reaplica idéntica');
end $t$;
-- con una reserva de horario, el down se niega
savepoint con_datos;
do $t$ declare v_pos uuid := tests.user('pos'); cu uuid; p uuid; d jsonb; begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'RB-ENTH', 5);
  insert into public.customers (full_name, phone, source) values ('Rb Horario', '6670001111', 'odoo') returning id into cu;
  perform tests.act_as(v_pos);
  select s || jsonb_build_object('fecha', dd ->> 'fecha') into d from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') s where (s ->> 'disponible')::boolean limit 1;
  perform public.crear_pedido_con_entrega(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), '{"address":{"line1":"Calle 1","cp":"80020","phone":"6671234567"}}'::jsonb, false, cu, null,
                                           jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', d ->> 'fecha', 'inicio', d ->> 'inicio')));
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.entrega_horarios where estado = 'reservado'), 1, '189 · hay una reserva');
end $t$;
do $t$ begin
  begin
    execute $d$ do $pre$ begin if coalesce(current_setting('app.entrega_horarios_rollback_forzado', true), '') <> 'on' and to_regclass('public.entrega_horarios') is not null and exists (select 1 from public.entrega_horarios) then raise exception 'ENT-H down: hay horarios de entrega reservados; no se revierte en automático'; end if; end $pre$ $d$;
    perform tests.ok(false, '189 down · con reservas debe negarse');
  exception when others then
    perform tests.ok(sqlerrm like 'ENT-H down: hay horarios%', '189 down · con reservas se niega (la guarda del down)');
  end;
end $t$;
rollback to savepoint con_datos;
rollback;
