-- SEG-CLI-2 (23 nov 2026) · dueño: los clientes de Odoo son clientes activos YA VERIFICADOS (decisión 14 oct 2026: su
-- cuenta nace verificada al aceptar la invitación). En la cartera del vendedor, un cliente sin portal que viene de Odoo
-- cuenta como verificado (listo para invitar); los prospectos nuevos (conversación, vendedor) no.
do $patch$
declare v text := pg_get_functiondef('public.cc_mi_cartera()'::regprocedure);
  a1 constant text := ' ''portal'', false, ''verificado'', false,';
begin
  if position(a1 in v) = 0 then raise exception 'SEG-CLI-2: cc_mi_cartera cambió'; end if;
  execute replace(v, a1, ' ''portal'', false, ''verificado'', (cu.source = ''odoo''),');
end $patch$;
