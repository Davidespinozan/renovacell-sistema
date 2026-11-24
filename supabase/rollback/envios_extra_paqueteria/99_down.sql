-- Rollback de 20270407880000_envios_extra_paqueteria.sql: _entrega_extras vuelve a no leer la paquetería del extra.
-- Los pedidos ya creados conservan extras[i].paqueteria en shipping_meta (dato inofensivo: Almacén solo lo preselecciona).
do $$
declare d text := pg_get_functiondef('public._entrega_extras(text,jsonb,jsonb)'::regprocedure);
  i1 int := position('    -- PAQUETERÍA POR ENVÍO' in d);
  i2 int := position('    snap := public._cc_chk_direccion_snapshot(x -> ''address'');' in d);
begin
  if i1 = 0 or i2 = 0 or i2 < i1 then raise exception 'ROLLBACK ENVIOS_EXTRA_PAQ: _entrega_extras no trae el parche'; end if;
  d := left(d, i1 - 1) || substr(d, i2);
  d := replace(d, 'k int := 0; v_costo numeric; v_paq text; cfg public.entrega_config;', 'k int := 0; v_costo numeric;');
  d := replace(d, '''lineas'', v_lineas, ''flete'', v_costo, ''paqueteria'', v_paq);', '''lineas'', v_lineas, ''flete'', v_costo);');
  execute d;
end $$;
revoke all on function public._entrega_extras(text, jsonb, jsonb) from public, anon, authenticated;
