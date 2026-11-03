-- Reversa de 20270320120000_salida_programada.sql.
drop function if exists public.entrega_salida_programar(uuid, date, jsonb, text);
do $d$
declare v text := pg_get_functiondef('public.cc_cliente_pedidos(uuid)'::regprocedure);
begin
  if position(', ''entrega'', o.shipping_meta -> ''entrega'',' in v) > 0 then execute replace(v, ', ''entrega'', o.shipping_meta -> ''entrega'',', ','); end if;
end $d$;
do $d$
declare v text; i int; j int;
begin
  v := pg_get_functiondef('public._entrega_servicio(jsonb,jsonb,timestamptz)'::regprocedure);
  i := position('  v_corr := coalesce(' in v);
  if i > 0 then
    j := position('  -- Un ajuste del personal con motivo manda sobre la regla;' in v);
    v := substr(v, 1, i - 1) || substr(v, j);
    execute replace(v, ' v_flete numeric; v_corr int;', ' v_flete numeric;');
  end if;
  v := pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure);
  i := position('  -- SALIDA PROGRAMADA:' in v);
  if i > 0 then
    -- quita el bloque: desde su comentario hasta la validación de la opción que lo seguía
    v := substr(v, 1, i - 1) || substr(v, position('  if o is null then raise exception ''ENTREGA_INVALIDA' in v));
    v := replace(v, 'declare ops jsonb; o jsonb; v_id text; v_prog date; v_calc timestamptz := p_ahora; v_normal date;', 'declare ops jsonb; o jsonb; v_id text;');
    v := replace(v, 'p_eleccion -> ''horario'' ->> ''inicio'', v_calc, true);   -- con salida programada, el horario es desde esa fecha', 'p_eleccion -> ''horario'' ->> ''inicio'', p_ahora, true);');
    v := replace(v, '    ''actor'', p_actor, ''programada'', case when v_prog is not null then true end, ''calculado_at'', p_ahora)),
    p_eleccion || case when v_prog is not null then jsonb_build_object(''_salida_normal'', v_normal) else ''{}''::jsonb end, p_ahora);', '    ''actor'', p_actor, ''calculado_at'', p_ahora)), p_eleccion, p_ahora);');
    execute v;
  end if;
end $d$;
