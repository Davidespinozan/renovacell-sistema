-- Reversa de 20270407800000_cobro_al_recibir_terminal.sql.
do $d$
declare v text;
begin
  v := pg_get_functiondef('public._venta_aplicar_cobro(uuid,jsonb,uuid)'::regprocedure);
  v := regexp_replace(v, '\n    -- AL-RECIBIR · cómo va a pagar al recibir.*?\n    end if;', '', 's');
  execute v;
  execute replace(pg_get_functiondef('public.registrar_cobro_entrega(uuid,uuid,text,numeric,text)'::regprocedure),
    'if p_metodo is null or p_metodo not in (''efectivo'', ''transferencia'', ''tarjeta'') then raise exception ''METODO_INVALIDO: efectivo, terminal o transferencia''',
    'if p_metodo is null or p_metodo not in (''efectivo'', ''transferencia'') then raise exception ''METODO_INVALIDO: efectivo o transferencia''');
end $d$;
