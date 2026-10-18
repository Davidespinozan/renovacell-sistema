-- PROMO-8 · rollback de la 179: se retiran los avisos de promoción; _promo_json vuelve a la 175.
drop function public.promocion_avisos_marcar(uuid, uuid[]);
drop function public.promocion_avisos_pendientes(uuid);
alter table public.promocion_envios drop column avisado_at;
create or replace function public._promo_json(p_id uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'desde', p.desde, 'hasta', p.hasta, 'activa', p.activa, 'listas', p.listas,
           'estado', case when not p.activa then 'inactiva' when public._promo_hoy() < p.desde then 'proxima' when public._promo_hoy() > p.hasta then 'vencida' else 'vigente' end,
           'lineas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'product_id', l.product_id, 'producto', pr.name, 'precio_normal', pr.price, 'min_qty', l.min_qty, 'precio', l.precio) order by pr.name, l.min_qty)
                                from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p.id), '[]'::jsonb),
           'ventas', public._promo_ventas(p.id),
           'difusion', (select jsonb_build_object('correo', count(*) filter (where e.canal = 'correo' and e.estado = 'encolado'), 'chat', count(*) filter (where e.canal = 'chat' and e.estado = 'entregado'),
                                                  'sin_correo', count(*) filter (where e.estado = 'sin_correo'), 'ultimo', max(e.created_at)) from public.promocion_envios e where e.promocion_id = p.id),
           'updated_at', p.updated_at)
    from public.promociones p where p.id = p_id
$$;
