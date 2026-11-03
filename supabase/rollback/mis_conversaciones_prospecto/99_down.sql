-- Reversa de 20270326120000_mis_conversaciones_prospecto.sql.
do $p$
declare d text := pg_get_functiondef('public.cc_mis_conversaciones()'::regprocedure);
begin
  execute replace(d, '''prospecto'', c.profile_id is null and c.customer_id is null,', '''prospecto'', c.profile_id is null,');
end $p$;
