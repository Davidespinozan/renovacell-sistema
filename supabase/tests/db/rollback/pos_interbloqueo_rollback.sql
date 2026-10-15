-- CAJA SIN INTERBLOQUEOS (166) · el down regresa la llave a revisión inmediata; se reaplica igual. Ninguna función cambia.
begin;
create temp table _pi as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/pos_sin_interbloqueo/99_down.sql
do $t$ begin
  perform tests.ok((select not condeferrable from pg_constraint where conname = 'order_items_lot_id_fkey') and (select todas from _pi) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '166 down · la llave vuelve a ser inmediata; ninguna función cambió');
end $t$;
\ir ../../../migrations/20261219120000_pos_sin_interbloqueo.sql
do $t$ begin
  perform tests.ok((select condeferrable and condeferred from pg_constraint where conname = 'order_items_lot_id_fkey'), '166 · se reaplica');
end $t$;
rollback;
