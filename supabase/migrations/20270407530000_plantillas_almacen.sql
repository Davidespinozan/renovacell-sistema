-- WA-PLANTILLAS-ALM (23 nov 2026) · dueño: "hay que darle acceso a Alberto a que pueda él mandar las plantillas a
-- autorización de Meta". Almacén (Alberto, que ya lleva promociones y flyers) crea, edita y borra plantillas igual que
-- Dirección; el envío a Meta lo hace la Edge wa-plantillas (también abierta a Almacén).
do $patch$
declare f text; v text;
begin
  foreach f in array array['public.cc_wa_plantilla_guardar', 'public.cc_wa_plantilla_borrar'] loop
    v := pg_get_functiondef(f::regproc);
    if position('if auth.uid() is null or not public._cc_es_admin() then raise exception ''NO_AUTORIZADO: solo Dirección''' in v) = 0 then
      raise exception 'WA-PLANTILLAS-ALM: % cambió', f; end if;
    execute replace(v, 'if auth.uid() is null or not public._cc_es_admin() then raise exception ''NO_AUTORIZADO: solo Dirección''',
                       'if auth.uid() is null or not (public._cc_es_admin() or public.auth_role() = ''warehouse'') then raise exception ''NO_AUTORIZADO: solo Dirección o Almacén''');
  end loop;
end $patch$;
