-- AUXILIAR DE ALMACÉN · el down devuelve 'packing' a las 8 funciones; nada más cambia; se reaplica idéntica.
begin;
create temp table _ax as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('recibir_lote', 'anular_guia', 'abrir_custodia', 'entregar_custodia', 'devolver_de_custodia', 'registrar_perdida_custodia', 'confirmar_reingreso', 'recibir_devolucion')) resto;
\ir ../../../rollback/auxiliar_almacen/99_down.sql
do $t$ begin
  perform tests.ok((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('recibir_lote', 'anular_guia', 'abrir_custodia', 'entregar_custodia', 'devolver_de_custodia', 'registrar_perdida_custodia', 'confirmar_reingreso', 'recibir_devolucion') and prosrc ~ $$'packing'$$) = 8, 'AUXILIAR down · las 8 funciones vuelven a aceptar packing');
  perform tests.ok((select resto from _ax) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('recibir_lote', 'anular_guia', 'abrir_custodia', 'entregar_custodia', 'devolver_de_custodia', 'registrar_perdida_custodia', 'confirmar_reingreso', 'recibir_devolucion')), 'AUXILIAR down · ninguna otra función cambió');
end $t$;
\ir ../../../migrations/20270201120000_auxiliar_almacen.sql
do $t$ begin
  perform tests.ok((select todas from _ax) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'AUXILIAR · se reaplica idéntica');
end $t$;
rollback;
