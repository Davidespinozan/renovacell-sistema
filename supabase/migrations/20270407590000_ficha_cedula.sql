-- ALTA COMPLETA · corrección de la auditoría (23 nov 2026): la ficha solo leía la cédula de la CUENTA del portal (y solo
-- para Dirección), así que la de un cliente sin cuenta (customers.meta.cedula: alta desde conversación y
-- cliente_cedula_guardar) nunca se veía. Ahora el resumen trae la cédula: la de la cuenta si la tiene, si no la de la ficha.
do $m$
declare v text := pg_get_functiondef('public.cliente_360'::regproc);
  viejo text := $$'nombre', c.full_name, 'activo', c.active,$$;
begin
  if position(viejo in v) = 0 then raise exception 'FICHA-CEDULA: cliente_360 no es la esperada'; end if;
  execute replace(v, viejo, $$'nombre', c.full_name, 'cedula', coalesce(nullif(p.meta ->> 'cedula', ''), nullif(c.meta ->> 'cedula', '')), 'activo', c.active,$$);
end $m$;
