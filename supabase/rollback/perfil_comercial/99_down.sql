-- HERRAMIENTAS DEL VENDEDOR · bloque B (20270215) · down: fuera la clasificación (se pierde lo capturado: se avisa antes de
-- bajarla en producción) y el catálogo; nada existente cambió.
drop function public.especialidad_guardar(text, boolean);
drop function public.mis_clientes_perfil(text, boolean, integer, integer);
drop function public.cliente_perfil_comercial_guardar(uuid, text, text, text);
drop function public.cliente_perfil_comercial(uuid);
drop function public._puede_perfil_cliente(uuid);
drop index if exists public.idx_customers_tipo;
alter table public.customers drop column perfil_actualizado_por, drop column perfil_actualizado_at, drop column especialidad_otra, drop column especialidad, drop column tipo_cliente;
drop table public.especialidades;
