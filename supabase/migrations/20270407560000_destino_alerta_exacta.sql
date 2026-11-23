-- DESTINO EN EL MAPA (0756) · la alerta «se marcó entregado lejos del destino» solo contra pines EXACTOS (aprendidos de
-- una entrega real). OpenStreetMap encuentra la calle pero no el número, y una calle puede medir kilómetros: comparar contra
-- ese punto daba alertas falsas.
do $m$
declare v text := pg_get_functiondef('public._tr_entrega_aprende_pin()'::regprocedure);
  viejo text := $$v_confiable := p.fuente = 'entrega' or p.precision = 'calle';$$;
begin
  if position(viejo in v) = 0 then raise exception 'DESTINO-ALERTA: _tr_entrega_aprende_pin no es la esperada'; end if;
  execute replace(v, viejo, $$v_confiable := p.fuente = 'entrega';$$);
end $m$;
