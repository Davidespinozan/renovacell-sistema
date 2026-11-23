-- SEG-CLI (23 nov 2026) · el dueño quiere segmentar Clientes en Verificados / Con portal / Sin portal en todos los roles.
-- La cartera del vendedor (cc_mi_cartera) ahora dice si cada cliente tiene portal y si su cuenta está verificada.
-- Solo agrega dos llaves al JSON (portal, verificado); nada más cambia.
do $patch$
declare v text := pg_get_functiondef('public.cc_mi_cartera()'::regprocedure);
  a1 constant text := '''nombre'', coalesce(p.full_name, p.meta ->> ''name'', p.email),';
  a2 constant text := 'jsonb_build_object(''profile_id'', null, ''customer_id'', cu.id, ''nombre'', cu.full_name,';
begin
  if position(a1 in v) = 0 or position(a2 in v) = 0 then raise exception 'SEG-CLI: cc_mi_cartera cambió'; end if;
  if position('''verificado''' in v) > 0 then raise exception 'SEG-CLI: cc_mi_cartera ya trae verificado'; end if;
  v := replace(v, a1, a1 || ' ''portal'', true, ''verificado'', coalesce(p.verified, false),');
  v := replace(v, a2, a2 || ' ''portal'', false, ''verificado'', false,');
  execute v;
end $patch$;
