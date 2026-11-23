-- Reversa de 20270407700000_por_cobrar_caja_credito.sql.
do $d$
begin
  execute replace(pg_get_functiondef('public.kpi_por_cobrar()'::regprocedure),
    '     and (coalesce(m.external_ref, '''') not like ''POS%'' or m.credito_autorizado);   -- Caja a crédito sí es deuda',
    '     and coalesce(m.external_ref, '''') not like ''POS%'';');
end $d$;
