-- SEC-C4-FISCAL-3 (147) · el down elimina ÚNICAMENTE crear_pedido_con_receptor: crear_pedido y la 146 quedan con su
-- huella, no cambian datos ni permisos de otras funciones, y los pedidos creados con la función conservan su receptor.
-- Después se vuelve a aplicar la 147 y el estado final es el mismo.
begin;
\ir ../../../rollback/mayoreo_reglas/99_down.sql   -- MAYOREO-REGLAS (20270222) redefine precio y cobro: se baja antes de la foto inicial
do $t$
declare posA uuid := tests.user('pos'); p uuid := tests.product(100); c uuid; o uuid := gen_random_uuid();
begin
  perform tests.act_as_service(); insert into public.customers (full_name, source) values ('Cuenta RB F3', 'odoo') returning id into c;
  perform tests.act_as(posA);
  perform public.crear_pedido_con_receptor(o, 'F3-RB1', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), '{}'::jsonb, true, c, tests.fiscal());
  perform tests.act_as_owner();
end $t$;
create temp table _f3 as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '-'), ',' order by p.oid::regprocedure::text))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '-'), ',' order by p.oid::regprocedure::text))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'crear_pedido_con_receptor') resto,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) n_fn,
  (select count(*) from public.orders) n_o, (select md5(string_agg(id::text || coalesce(invoice_meta::text, '-'), ',' order by id)) from public.orders) h_o,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace) || '/' || (select count(*) from pg_policies where schemaname = 'public') || '/' ||
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) objs;
-- Orden de bajada: con la 147 activa, el down de la 146 se NIEGA (si no, crear_pedido_con_receptor quedaría rota).
savepoint antes_146;
\set ON_ERROR_STOP 0
\ir ../../../rollback/sec_c4_fiscal2/99_down.sql
\set ON_ERROR_STOP 1
rollback to savepoint antes_146;
do $t$ begin
  perform tests.ok(to_regprocedure('public._fiscal_entrada_error(jsonb)') is not null
               and md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) = '643cda22dcd76283ae8225ebb6afd188'
               and md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) = '5769c551e6ca60003ba0fcf9390d80d1',
    '146 down con la 147 activa · se niega: la 146 y la 147 quedan intactas');
end $t$;
\ir ../../../rollback/sec_c4_fiscal3/99_down.sql
do $t$
declare SIG7 text := 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)';
begin
  perform tests.ok(to_regprocedure('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)') is null
               and not exists (select 1 from pg_proc where proname = 'crear_pedido_con_receptor'), '147 down · la función nueva ya no existe');
  perform tests.ok((select resto from _f3) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '-'), ',' order by p.oid::regprocedure::text))
                      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select n_fn from _f3) = (select count(*) + 1 from pg_proc where pronamespace = 'public'::regnamespace),
    '147 down · TODAS las demás funciones quedan idénticas (definición y permisos); solo desapareció una');
  perform tests.ok(md5(pg_get_functiondef(SIG7::regprocedure)) = 'bee5aa3614e2b9e0327ebec6a1b38e2e' and has_function_privilege('authenticated', SIG7, 'execute') and not has_function_privilege('anon', SIG7, 'execute'),
    '147 down · crear_pedido conserva su huella y sus permisos');
  perform tests.ok(md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) = '643cda22dcd76283ae8225ebb6afd188'
               and md5(pg_get_functiondef('public._w3_receptor(uuid,jsonb)'::regprocedure)) = 'bb7b1d1a51edd1cbf4e8427045fb0dcb'
               and md5(pg_get_functiondef('public._fiscal_entrada_error(jsonb)'::regprocedure)) = 'b651a11fd4cd94040473a1aa503986c0'
               and md5(pg_get_functiondef('public._fiscal_entrada_pos(boolean,jsonb)'::regprocedure)) = '53d053a6956644148ceffb62526c0ea1', '147 down · la 146 (FISCAL-2) permanece intacta');
  perform tests.ok((select n_o = (select count(*) from public.orders) and h_o = (select md5(string_agg(id::text || coalesce(invoice_meta::text, '-'), ',' order by id)) from public.orders) from _f3)
               and (select invoice_meta -> 'receiver' ->> 'rfc' = 'XAXX010101000' from public.orders where external_ref = 'F3-RB1'),
    '147 down · pedidos y receptores ya registrados se conservan (incluido el creado con la función)');
  perform tests.ok((select objs from _f3) = (select (select count(*) from pg_class where relnamespace = 'public'::regnamespace) || '/' || (select count(*) from pg_policies where schemaname = 'public') || '/' ||
                    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal)), '147 down · sin cambios de tablas, políticas ni triggers');
end $t$;
\ir ../../../migrations/20261130120000_sec_c4_fiscal3_order_receiver.sql
do $t$
begin
  perform tests.ok((select todas from _f3) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '-'), ',' order by p.oid::regprocedure::text))
                      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '147 up tras down · el conjunto completo de funciones vuelve a ser idéntico al de antes (ciclo reproducible)');
end $t$;
rollback;
