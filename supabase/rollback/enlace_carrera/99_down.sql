-- Reversa de 20270315120000_enlace_carrera.sql.
do $d$
declare v text;
begin
  v := pg_get_functiondef('public._cc_enlace_de_vendedor(uuid)'::regprocedure);
  if position('  perform pg_advisory_xact_lock(hashtext(''cc_enlace:vendedor:'' || p_seller::text));   -- una creación a la vez por vendedor
' in v) > 0 then execute replace(v, '  perform pg_advisory_xact_lock(hashtext(''cc_enlace:vendedor:'' || p_seller::text));   -- una creación a la vez por vendedor
', ''); end if;
  v := pg_get_functiondef('public._cc_enlace_de_cliente(uuid)'::regprocedure);
  if position('  perform pg_advisory_xact_lock(hashtext(''cc_enlace:referido:'' || p_customer::text));   -- una creación a la vez por cliente
' in v) > 0 then execute replace(v, '  perform pg_advisory_xact_lock(hashtext(''cc_enlace:referido:'' || p_customer::text));   -- una creación a la vez por cliente
', ''); end if;
end $d$;
