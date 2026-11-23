-- 0758 down: sin comando de cédula para clientes sin portal.
drop function if exists public.cliente_cedula_guardar(uuid, text);
