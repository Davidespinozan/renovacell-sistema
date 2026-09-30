-- W2-C · El rollback devuelve EXACTAMENTE el estado que dejó W2. Corre en una
-- transacción y se revierte: no deja la BD de pruebas sin W2-C.
-- Hashes capturados de un cluster con las migraciones hasta W2 inclusive.
begin;
\ir ../../../rollback/w2c/00_w2_snapshot.sql
\ir ../../../rollback/w2c/99_down.sql
do $t$
declare r record;
begin
  for r in select * from (values
    ('ajustar_lote(uuid,uuid,integer,text,text,uuid)',                                  'af8dfedb971e91766e4ecbbaa745d68e'),
    ('surtir_pedido(uuid,uuid,jsonb)',                                                  '05be5498b731a2d70ace960a0408622d'),
    ('vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric)', '4fead2d82e9ee084d2610bcabf88450c'),
    ('event_sell(uuid,jsonb)',                                                          '453593fac9bdf3fda3b2c3e745b22ce4')
  ) as t(sig, h) loop
    perform tests.eq(md5(pg_get_functiondef(('public.' || r.sig)::regprocedure)), r.h,
      'rollback W2-C restaura la versión de W2: ' || r.sig);
  end loop;

  perform tests.eq(md5(pg_get_viewdef('public.product_stock'::regclass, true)), '19f1823f8f69becd5ee5b7ac45b18d1f',
    'rollback W2-C: product_stock vuelve a su definición previa');
  perform tests.eq((select md5(string_agg(tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' order by tablename, policyname))
                      from pg_policies where schemaname = 'public' and tablename in ('events','consignment_stock')),
                   '70d1f87bfd43675de92874278a42ebf9', 'rollback W2-C: políticas legacy iguales a W2');
  perform tests.eq((select md5(string_agg(table_name||'|'||grantee||'|'||privilege_type, E'\n' order by table_name, grantee, privilege_type))
                      from information_schema.role_table_grants where table_schema = 'public'
                       and table_name in ('events','consignment_stock') and grantee in ('anon','authenticated')),
                   'e8229e417ee58fcb81b27c1571e53cca', 'rollback W2-C: grants legacy iguales a W2');
  perform tests.eq((select md5(string_agg(table_name||'|'||column_name||'|'||data_type, E'\n' order by table_name, column_name))
                      from information_schema.columns where table_schema = 'public' and table_name in ('events','consignment_stock')),
                   'a1368f387434a56657081928e66f2ca2', 'rollback W2-C: columnas legacy iguales a W2');

  -- Nada de W2-C queda vivo
  perform tests.eq((select count(*)::int from information_schema.tables where table_schema = 'public'
                     and table_name in ('custodies','custody_lines','custody_operations')), 0,
    'rollback W2-C: las tablas de custodia desaparecen');
  perform tests.eq((select count(*)::int from information_schema.views where table_schema = 'public'
                     and table_name in ('v_stock_disponible','v_custody_stock','v_custody_liquidacion')), 0,
    'rollback W2-C: las vistas de custodia desaparecen');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('custody_held','custody_held_en','abrir_custodia',
                       'entregar_custodia','devolver_de_custodia','registrar_perdida_custodia','cerrar_custodia',
                       'estado_custodia','conciliar_custodia','_w2c_perdida','_w2c_op_begin','_w2c_op_finish')), 0,
    'rollback W2-C: los comandos de custodia desaparecen');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'vender_pos'), 1,
    'rollback W2-C: queda UNA sola firma de vender_pos (la de W2)');

  -- W1 y W2 siguen enteros (sus propias conciliaciones existen y responden)
  perform tests.ok(to_regprocedure('public.conciliar_inventario()') is not null, 'rollback W2-C: W1 intacto');
  perform tests.ok(to_regprocedure('public.conciliar_dinero()') is not null, 'rollback W2-C: W2 intacto');
  perform tests.ok(to_regclass('public.payment_entries') is not null, 'rollback W2-C: el libro de dinero sigue ahí');
end
$t$;
rollback;
