-- Reversa de 20270407540000_saludo_sin_titulo.sql (SALUDO · 23 nov 2026).
do $d$
declare v text := pg_get_functiondef('public.cc_wa_plantilla_enviar'::regproc);
begin
  v := replace(v, 'v_cliente := coalesce(public._cc_primer_nombre(btrim(coalesce(', 'v_cliente := coalesce(nullif(split_part(btrim(coalesce(');
  v := replace(v, '                  k.nombre, ''''))), ''doctor(a)'');   -- SALUDO · sin títulos (Dr./Dra./Lic.)', '                  k.nombre, '''')), '' '', 1), ''''), ''doctor(a)'');
  v_cliente := initcap(lower(v_cliente));');
  execute v;
end $d$;
