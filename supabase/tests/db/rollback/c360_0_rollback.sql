-- C360-0 · El rollback devuelve EXACTAMENTE revisar/confirmar de 119 (confirmar vuelve a pasar null) y retira el helper.
begin;
\ir ../../../rollback/c360_0/99_down.sql
do $t$
begin
  perform tests.ok(to_regprocedure('public._cc_chk_customer(uuid)') is null, 'helper retirado');
  perform tests.ok(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean)'::regprocedure) like '%coalesce(p_factura, false), null)%', 'confirmar de 119 restaurado');
  perform tests.ok(pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb)'::regprocedure) not like '%CLIENTE_NO_VINCULADO%', 'revisar de 119 restaurado');
  perform tests.ok(has_function_privilege('authenticated', 'public.cc_checkout_confirmar(uuid,text,integer,boolean)', 'EXECUTE') and not has_function_privilege('anon', 'public.cc_checkout_confirmar(uuid,text,integer,boolean)', 'EXECUTE'), 'privilegios intactos');
end $t$;
rollback;
