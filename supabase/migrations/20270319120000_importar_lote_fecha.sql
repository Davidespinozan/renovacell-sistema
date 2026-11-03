-- ============================================================================
-- CARGA DE INVENTARIO: CADUCIDAD SIN AMBIGÜEDAD (ensayo 2 nov 2026). La base convierte texto a fecha con el estilo de
-- EE. UU. (DateStyle 'ISO, MDY'): "06/07/2027" (6 de julio en México) entraba como 7 de JUNIO sin aviso, lo que rompe el
-- orden "sale primero lo que caduca primero" y los avisos de caducidad. La pantalla ya traduce las fechas mexicanas;
-- aquí el servidor solo acepta AAAA-MM-DD, para que ningún otro camino vuelva a confundirlas.
-- ============================================================================
do $d$
declare v text;
begin
  v := pg_get_functiondef('public.importar_lote(uuid,text,text,text,integer)'::regprocedure);
  if position('    v_exp := btrim(p_caducidad)::date;' in v) = 0 then raise exception 'IMPORTAR_LOTE_FECHA: importar_lote cambió'; end if;
  execute replace(v, '    v_exp := btrim(p_caducidad)::date;', '    if btrim(p_caducidad) !~ ''^\d{4}-\d{2}-\d{2}$'' then raise exception ''formato''; end if;   -- solo AAAA-MM-DD (sin adivinar día/mes)
    v_exp := to_date(btrim(p_caducidad), ''YYYY-MM-DD'');
    if to_char(v_exp, ''YYYY-MM-DD'') <> btrim(p_caducidad) then raise exception ''fecha inexistente''; end if;');
end $d$;
