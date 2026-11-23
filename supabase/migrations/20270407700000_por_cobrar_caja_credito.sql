-- POR COBRAR · CAJA A CRÉDITO (23 nov 2026) · la Caja ya puede vender a crédito (COBRO-U): esas ventas son deuda y deben
-- contar en «Por cobrar». El resto del mostrador sigue fuera (se cobra en el acto). Mismo cambio en data/kpis.ts (paridad).
do $patch$
declare v text := pg_get_functiondef('public.kpi_por_cobrar()'::regprocedure);
  a1 constant text := '     and coalesce(m.external_ref, '''') not like ''POS%'';';
begin
  if position(a1 in v) = 0 then raise exception 'POR-COBRAR: kpi_por_cobrar cambió'; end if;
  execute replace(v, a1, '     and (coalesce(m.external_ref, '''') not like ''POS%'' or m.credito_autorizado);   -- Caja a crédito sí es deuda');
end $patch$;
