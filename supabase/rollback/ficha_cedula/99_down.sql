-- 0759 down: el resumen de la ficha deja de traer la cédula.
do $m$
declare v text := pg_get_functiondef('public.cliente_360'::regproc);
  nuevo text := $$'nombre', c.full_name, 'cedula', coalesce(nullif(p.meta ->> 'cedula', ''), nullif(c.meta ->> 'cedula', '')), 'activo', c.active,$$;
begin
  if position(nuevo in v) > 0 then execute replace(v, nuevo, $$'nombre', c.full_name, 'activo', c.active,$$); end if;
end $m$;
