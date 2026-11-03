-- ENLACE-CARRERA (20270315) · el enlace del vendedor y el del cliente se siguen creando una sola vez y se reutilizan.
begin;
do $t$
declare s1 uuid := tests.user('pos'); cu uuid; a text; b text;
begin
  perform tests.act_as_owner();
  insert into public.customers (full_name, source) values ('Cliente Enlace', 'odoo') returning id into cu;
  a := public._cc_enlace_de_vendedor(s1); b := public._cc_enlace_de_vendedor(s1);
  perform tests.ok(a is not null and a = b and (select count(*) from public.cc_enlaces where seller_profile_id = s1 and tipo = 'vendedor') = 1, '1 · vendedor: un solo enlace, reutilizado');
  a := public._cc_enlace_de_cliente(cu); b := public._cc_enlace_de_cliente(cu);
  perform tests.ok(a is not null and a = b and (select count(*) from public.cc_enlaces where customer_id = cu and tipo = 'referido') = 1, '2 · cliente: un solo enlace, reutilizado');
  perform tests.ok(pg_get_functiondef('public._cc_enlace_de_vendedor(uuid)'::regprocedure) like '%pg_advisory_xact_lock%', '3 · la creación se serializa');
end $t$;
rollback;
