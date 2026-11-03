-- ============================================================================
-- ENLACE: CARRERA AL CREARLO (ensayo E2E 2 nov 2026). La primera vez que un vendedor abre Conversaciones, dos partes de la
-- pantalla piden su enlace a la vez; las dos ven que no existe, las dos lo crean y la segunda choca con el índice único
-- (HTTP 409) → el enlace no aparece. Ahora la creación se serializa por vendedor/cliente y el segundo recibe el mismo.
-- ============================================================================
do $d$
declare v text;
begin
  v := pg_get_functiondef('public._cc_enlace_de_vendedor(uuid)'::regprocedure);
  if position('begin
  select codigo into v from public.cc_enlaces where tipo = ''vendedor'' and seller_profile_id = p_seller and activo;' in v) = 0 then raise exception 'ENLACE_CARRERA: _cc_enlace_de_vendedor cambió'; end if;
  execute replace(v, 'begin
  select codigo into v from public.cc_enlaces where tipo = ''vendedor'' and seller_profile_id = p_seller and activo;', 'begin
  perform pg_advisory_xact_lock(hashtext(''cc_enlace:vendedor:'' || p_seller::text));   -- una creación a la vez por vendedor
  select codigo into v from public.cc_enlaces where tipo = ''vendedor'' and seller_profile_id = p_seller and activo;');
  v := pg_get_functiondef('public._cc_enlace_de_cliente(uuid)'::regprocedure);
  if position('begin
  select codigo into v from public.cc_enlaces where tipo = ''referido'' and customer_id = p_customer and activo;' in v) = 0 then raise exception 'ENLACE_CARRERA: _cc_enlace_de_cliente cambió'; end if;
  execute replace(v, 'begin
  select codigo into v from public.cc_enlaces where tipo = ''referido'' and customer_id = p_customer and activo;', 'begin
  perform pg_advisory_xact_lock(hashtext(''cc_enlace:referido:'' || p_customer::text));   -- una creación a la vez por cliente
  select codigo into v from public.cc_enlaces where tipo = ''referido'' and customer_id = p_customer and activo;');
end $d$;
