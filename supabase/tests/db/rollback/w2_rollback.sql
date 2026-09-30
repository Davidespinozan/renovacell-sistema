-- W2 · El rollback devuelve EXACTAMENTE el estado que dejó W1. Corre en una
-- transacción y se revierte: no deja la BD de pruebas sin W2.
-- Hashes capturados de un cluster con las migraciones hasta W1 inclusive.
begin;
-- W2-C se apoya en v_order_money, así que primero baja W2-C.
\ir ../../../rollback/w2c/00_w2_snapshot.sql
\ir ../../../rollback/w2c/99_down.sql
\ir ../../../rollback/w2/99_down.sql
do $t$
declare r record;
begin
  for r in select * from (values
    ('surtir_pedido(uuid,uuid,jsonb)',                                          '868f81818229fd3957385085bfd9c989'),
    ('cancelar_pedido(uuid,uuid,text)',                                         '041f08839750b6ed3e7872e4943c92ee'),
    ('orders_guard()',                                                          '089446361edf13a8fdc1e43574102dba'),
    ('registrar_devolucion(uuid,text,numeric,text,text,jsonb)',                 '1773576a8c0d326507fa2ded0421a515'),
    ('review_transfer_payment(uuid,text,text)',                                 'b736bcd1c74e04c21121370b256f49d1'),
    ('vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid)', 'c4fc5b72047c2b49a4931d2aff46a7fc')
  ) as t(sig, h) loop
    perform tests.eq(md5(pg_get_functiondef(('public.' || r.sig)::regprocedure)), r.h,
      'rollback W2 restaura la versión de W1: ' || r.sig);
  end loop;
  perform tests.eq((select md5(string_agg(tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' order by tablename, policyname))
                      from pg_policies where schemaname = 'public' and tablename in ('cash_closings','orders','refunds','payment_entries')),
                   'f5c690093c880ee64a9a25bfdbfc16e6', 'rollback W2: políticas iguales a W1');
  perform tests.eq((select md5(string_agg(table_name||'|'||grantee||'|'||privilege_type, E'\n' order by table_name, grantee, privilege_type))
                      from information_schema.role_table_grants where table_schema = 'public'
                       and table_name in ('cash_closings','orders','refunds') and grantee in ('anon','authenticated')),
                   'ecc7b1333a9eda42157f520f29709d0c', 'rollback W2: grants iguales a W1');
  perform tests.eq((select md5(string_agg(table_name||'|'||column_name||'|'||data_type, E'\n' order by table_name, column_name))
                      from information_schema.columns where table_schema = 'public' and table_name in ('orders','refunds','cash_closings')),
                   '21277584fe14cf4d1d058f51f184105c', 'rollback W2: columnas iguales a W1');
  perform tests.eq((select md5(string_agg(conname||'|'||pg_get_constraintdef(oid), E'\n' order by conname))
                      from pg_constraint where conrelid in ('public.orders'::regclass,'public.refunds'::regclass,'public.cash_closings'::regclass)),
                   'cba03fdf39469d0b29036829471a5f28', 'rollback W2: constraints iguales a W1');
  perform tests.ok(has_function_privilege('authenticated', 'public.pay_order(uuid,text,text)', 'EXECUTE'),
    'rollback W2: pay_order vuelve a ser ejecutable (estado W1)');
  perform tests.ok(to_regclass('public.payment_entries') is null and to_regclass('public.payment_claims') is null
                   and to_regclass('public.credit_grants') is null and to_regclass('public.money_operations') is null,
    'rollback W2 elimina las tablas de dinero');
  perform tests.ok(to_regclass('public.v_order_money') is null, 'rollback W2 elimina v_order_money');
  -- W1 intacto tras bajar W2
  perform tests.ok(to_regclass('public.inventory_operations') is not null and to_regclass('public.stock_returns') is not null,
    'rollback W2 NO toca las tablas de W1');
end
$t$;
rollback;
