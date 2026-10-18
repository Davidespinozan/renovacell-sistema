-- DIFUSIÓN DE PROMOCIONES · rollback de la migración 175: se retira el registro de envíos y las funciones; _promo_json vuelve
-- a la 174; la plantilla 'promocion' sale del catálogo de correos (se niega si hay correos de promoción en cola).
do $pre$ begin
  if exists (select 1 from public.comm_outbox where plantilla = 'promocion') then raise exception 'PROMO-DIFUSION down: hay correos de promoción en la cola; no se revierte en automático'; end if;
end $pre$;
drop function public.promocion_difusion_previa(uuid, uuid);
drop function public.promocion_difundir(uuid, text[], uuid);
drop function public._promo_texto(uuid);
drop table public.promocion_envios;
alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in (
  'pedido_recibido','pago_recibido','pedido_enviado','pedido_entregado','pedido_cancelado','reembolso_realizado',
  'registro_recibido','cuenta_verificada','verificacion_rechazada'));
CREATE OR REPLACE FUNCTION public._promo_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'desde', p.desde, 'hasta', p.hasta, 'activa', p.activa, 'listas', p.listas,
           'estado', case when not p.activa then 'inactiva' when public._promo_hoy() < p.desde then 'proxima' when public._promo_hoy() > p.hasta then 'vencida' else 'vigente' end,
           'lineas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'product_id', l.product_id, 'producto', pr.name, 'precio_normal', pr.price, 'min_qty', l.min_qty, 'precio', l.precio) order by pr.name, l.min_qty)
                                from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p.id), '[]'::jsonb),
           'ventas', public._promo_ventas(p.id),
           'updated_at', p.updated_at)
    from public.promociones p where p.id = p_id
$function$

;
do $post$ begin
  if md5(pg_get_functiondef('public._promo_json(uuid)'::regprocedure)) <> 'ec783caa568791d9e3f9e5d712d4b386' then raise exception 'PROMO-DIFUSION down: _promo_json no quedó como en la 174'; end if;
end $post$;
