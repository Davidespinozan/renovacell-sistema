-- ATRIBUCIÓN Y PAGADO (20270203) · el down devuelve atribución, cobro, evaluador y políticas a su texto exacto anterior y
-- retira el aviso de pedido nuevo; la migración se reaplica idéntica.
begin;
\ir ../../../rollback/ensayo_golive/99_down.sql   -- ENSAYO-GOLIVE (20270204) se baja antes (redefine el aviso de pedido nuevo)
create temp table _ap as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public') pols;
\ir ../../../rollback/atribucion_pagado/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._aviso_pedido_nuevo()') is null
               and md5(pg_get_functiondef('public._cx0c_atribucion'::regproc)) = 'a63db4247f427b280aa1ab4a65c21fdc'
               and md5(pg_get_functiondef('public._w2_recalc_payment_status'::regproc)) = '05ee561cb0e6ad9a6068e29af798acd5'
               and md5(pg_get_functiondef('public.cc_atencion_evaluar'::regproc)) = '905f2f96f8c80a0f78693b46e8087e97', 'ATRIBUCIÓN-PAGADO down · funciones exactas de antes, sin aviso de pedido nuevo');
end $t$;
\ir ../../../migrations/20270203120000_atribucion_cartera_y_pagado.sql
do $t$ begin
  perform tests.ok((select todas from _ap) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select pols from _ap) = (select md5(string_agg(tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public'), 'ATRIBUCIÓN-PAGADO · se reaplica idéntica');
end $t$;
rollback;
