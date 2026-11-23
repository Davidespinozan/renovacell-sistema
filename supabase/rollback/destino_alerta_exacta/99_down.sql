-- 0756 down: la alerta vuelve a compararse también contra pines aproximados por calle.
do $m$
declare v text := pg_get_functiondef('public._tr_entrega_aprende_pin()'::regprocedure);
begin
  if position($$v_confiable := p.fuente = 'entrega';$$ in v) > 0 then
    execute replace(v, $$v_confiable := p.fuente = 'entrega';$$, $$v_confiable := p.fuente = 'entrega' or p.precision = 'calle';$$); end if;
end $m$;
