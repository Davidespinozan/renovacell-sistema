-- FLYERS · rollback de la 180: se retiran los flyers y _promo_texto vuelve al texto exacto de la 177.
drop function public.flyer_eliminar(uuid);
drop function public.flyer_estado(uuid, boolean);
drop function public.flyer_guardar(jsonb);
drop function public.flyers_lista(boolean);
drop function public.flyers_vigentes();
drop function public._flyer_json(public.flyers);
drop function public._flyer_estado(public.flyers);
drop table public.flyers;
create or replace function public._promo_texto(p_id uuid) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare p public.promociones%rowtype; v_lineas text[]; v_vig text; r record; v_t text; v_prods jsonb;
  meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  select * into p from public.promociones where id = p_id;
  if not found then return null; end if;
  v_vig := case when extract(month from p.desde) = extract(month from p.hasta)
                then format('del %s al %s de %s', extract(day from p.desde)::int, extract(day from p.hasta)::int, meses[extract(month from p.hasta)::int])
                else format('del %s de %s al %s de %s', extract(day from p.desde)::int, meses[extract(month from p.desde)::int], extract(day from p.hasta)::int, meses[extract(month from p.hasta)::int]) end;
  for r in select pr.name, array_agg(format('%s%s', case when l.min_qty > 1 then 'desde ' || l.min_qty || ' pzas ' else '' end, '$' || to_char(l.precio, 'FM999,999,990')) order by l.min_qty) as esc
             from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p_id group by pr.name order by pr.name loop
    v_lineas := array_append(v_lineas, r.name || ': ' || array_to_string(r.esc, ' · '));
  end loop;
  -- PROMO-6 · productos con foto y precios para el correo y la tarjeta del chat.
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.id, 'nombre', x.name, 'imagen_url', x.image_url, 'presentacion', x.unit, 'precio_normal', x.price, 'escalones', x.esc) order by x.name), '[]'::jsonb) into v_prods
    from (select pr.id, pr.name, pr.image_url, pr.unit, pr.price, jsonb_agg(jsonb_build_object('desde', l.min_qty, 'precio', l.precio) order by l.min_qty) as esc
            from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p_id group by pr.id, pr.name, pr.image_url, pr.unit, pr.price) x;
  v_t := format('%s (%s)%s%s%sPrecios para profesionales verificados; se aplican solos en tu portal al pedir.', p.nombre, v_vig, E'\n', array_to_string(v_lineas, E'\n'), E'\n');
  return jsonb_build_object('nombre', p.nombre, 'descripcion', p.descripcion, 'vigencia', v_vig, 'desde', p.desde, 'hasta', p.hasta, 'lineas', to_jsonb(v_lineas), 'productos', v_prods, 'texto', v_t);
end;
$$;
