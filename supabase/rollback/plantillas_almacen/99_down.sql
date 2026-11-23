-- Reversa de 20270407530000_plantillas_almacen.sql (WA-PLANTILLAS-ALM · 23 nov 2026).
do $d$
declare f text;
begin
  foreach f in array array['public.cc_wa_plantilla_guardar', 'public.cc_wa_plantilla_borrar'] loop
    execute replace(pg_get_functiondef(f::regproc),
      'if auth.uid() is null or not (public._cc_es_admin() or public.auth_role() = ''warehouse'') then raise exception ''NO_AUTORIZADO: solo Dirección o Almacén''',
      'if auth.uid() is null or not public._cc_es_admin() then raise exception ''NO_AUTORIZADO: solo Dirección''');
  end loop;
end $d$;
