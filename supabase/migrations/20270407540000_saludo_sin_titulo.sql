-- SALUDO (23 nov 2026) · las plantillas de WhatsApp saludaban con la primera palabra del nombre: «Dra. Ana López» → «Hola Dra.,».
-- Ahora usan _cc_primer_nombre (ya quita Dr./Dra./Doctor/Lic./Ing.): «Hola Ana,». Si no hay nombre usable, «doctor(a)».
do $patch$
declare v text := pg_get_functiondef('public.cc_wa_plantilla_enviar'::regproc);
  a1 constant text := '                  k.nombre, '''')), '' '', 1), ''''), ''doctor(a)'');
  v_cliente := initcap(lower(v_cliente));';
begin
  if position(a1 in v) = 0 or position('v_cliente := coalesce(nullif(split_part(btrim(coalesce(' in v) = 0 then raise exception 'SALUDO: cc_wa_plantilla_enviar cambió'; end if;
  v := replace(v, 'v_cliente := coalesce(nullif(split_part(btrim(coalesce(', 'v_cliente := coalesce(public._cc_primer_nombre(btrim(coalesce(');
  v := replace(v, a1, '                  k.nombre, ''''))), ''doctor(a)'');   -- SALUDO · sin títulos (Dr./Dra./Lic.)');
  execute v;
end $patch$;
