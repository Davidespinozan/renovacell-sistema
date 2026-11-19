-- VENTAS (19 nov 2026) · la búsqueda de clientes del vendedor tenía un tope de 300 resultados por día (≈30 búsquedas): con
-- carteras de 600–1,250 clientes se agotaba a media jornada y ya no podía elegir cliente. Su cartera ahora se filtra en el
-- propio selector (no gasta cupo) y el cupo de la búsqueda en TODO el directorio sube a 1,500 filas por día. Se conservan
-- los demás frenos contra copiar el directorio (frecuencia por minuto, búsquedas inválidas, máximo 10 por búsqueda).
do $patch$
declare d text := pg_get_functiondef('public.buscar_clientes_pos(text,integer)'::regprocedure);
begin
  if position('v_resto := 300 - c.filas;' in d) = 0 or position('if c.filas + v_dadas >= 300 then' in d) = 0 then
    raise exception 'BUSQUEDA-CUPO: buscar_clientes_pos cambió; revisar'; end if;
  d := replace(d, 'v_resto := 300 - c.filas;', 'v_resto := 1500 - c.filas;');
  d := replace(d, 'if c.filas + v_dadas >= 300 then', 'if c.filas + v_dadas >= 1500 then');
  d := replace(d, '-- 3c · Presupuesto: 300 filas', '-- 3c · Presupuesto: 1500 filas');
  execute d;
end $patch$;
