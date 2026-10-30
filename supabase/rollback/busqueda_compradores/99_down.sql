-- HERRAMIENTAS DEL VENDEDOR · bloque A (20270214) · down: fuera la búsqueda y los compradores por producto; nada existente cambió.
drop function public.cc_compradores_producto(uuid);
drop function public.cc_productos_compradores();
drop function public._alcance_compradores();
drop function public._ventas_cliente_producto();
drop function public.cc_buscar_mensajes(text, integer);
drop function public._cc_busq_norm(text);
drop index if exists public.idx_order_items_product;
drop index if exists public.idx_order_items_order;
