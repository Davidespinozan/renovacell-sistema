-- Reversa de 20270319120000_importar_lote_fecha.sql.
do $d$
declare v text;
begin
  v := pg_get_functiondef('public.importar_lote(uuid,text,text,text,integer)'::regprocedure);
  if position('-- solo AAAA-MM-DD (sin adivinar día/mes)' in v) > 0 then
    execute replace(v, '    if btrim(p_caducidad) !~ ''^\d{4}-\d{2}-\d{2}$'' then raise exception ''formato''; end if;   -- solo AAAA-MM-DD (sin adivinar día/mes)
    v_exp := to_date(btrim(p_caducidad), ''YYYY-MM-DD'');
    if to_char(v_exp, ''YYYY-MM-DD'') <> btrim(p_caducidad) then raise exception ''fecha inexistente''; end if;', '    v_exp := btrim(p_caducidad)::date;');
  end if;
end $d$;
