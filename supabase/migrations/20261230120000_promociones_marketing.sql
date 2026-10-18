-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PROMOCIONES CON IMAGEN (migración 177) · PROMO-6: el correo y el mensaje de chat de una promoción llevan los productos con
--   su foto, precio normal y precio promo, y Dirección VE el correo y el mensaje tal cual antes de enviarlos.
--   Dueño (18 oct 2026): "no me gusta que dice enviar a doctores pero no puedo ver qué envío … previsualización del correo y
--   del mensaje … con imágenes de los productos … buen marketing".
--   · _promo_texto               + 'productos' (nombre, imagen, precio normal, escalones) para el correo y la tarjeta del chat.
--   · promocion_difundir         el mensaje del chat lleva una marca [promo:<id>] en la primera línea: el portal la pinta como
--                                tarjeta con fotos; si la promo ya terminó, se ve el texto.
--   · promocion_difusion_previa  devuelve 'datos' (lo mismo que recibe la plantilla del correo) y 'chat_texto'.
--   Depende de la 176. Rollback: supabase/rollback/promociones_marketing/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.promocion_eliminar(uuid)') is null then raise exception 'PROMO-MARKETING: falta la 176'; end if;
  if md5(pg_get_functiondef('public._promo_texto(uuid)'::regprocedure)) <> 'f6314e093c23a1131c65a5f9b8789cb1' then raise exception 'PROMO-MARKETING: _promo_texto no es la versión de la 175'; end if;
end $pre$;

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

create or replace function public.promocion_difundir(p_id uuid, p_canales text[], p_vendedor uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare p public.promociones%rowtype; tx jsonb; d record; v_conv uuid; v_n_correo int := 0; v_n_chat int := 0; v_sin_correo int := 0; v_ya int := 0; v_audiencia int := 0; v_canal text; v_chat text;
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación mandan promociones' using errcode = 'insufficient_privilege'; end if;
  select * into p from public.promociones where id = p_id for update;
  if not found then raise exception 'PROMO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if not p.activa or public._promo_hoy() > p.hasta then raise exception 'PROMO_NO_VIGENTE: solo se manda una promoción activa y que no haya terminado' using errcode = 'check_violation'; end if;
  if p_canales is null or cardinality(p_canales) = 0 or not (p_canales <@ array['correo', 'chat']) then raise exception 'CANAL_INVALIDO: elige correo, chat o los dos' using errcode = 'check_violation'; end if;
  tx := public._promo_texto(p_id);
  v_chat := '[promo:' || p_id::text || ']' || E'\n' || (tx ->> 'texto');   -- PROMO-6 · el portal pinta la tarjeta; el texto queda de respaldo
  for d in
    select pr.id, pr.email, coalesce(nullif(btrim(pr.full_name), ''), pr.meta ->> 'name') as nombre
      from public.profiles pr
      join public.customers c on c.profile_id = pr.id and c.active
     where pr.role_id = 'doctor' and pr.active and pr.verified
       and (p.listas is null or pr.price_list_id = any (p.listas))
       and (p_vendedor is null or exists (select 1 from public.cc_cartera k where k.profile_id = pr.id and k.seller_profile_id = p_vendedor))
     order by pr.id
  loop
    v_audiencia := v_audiencia + 1;
    foreach v_canal in array p_canales loop
      if exists (select 1 from public.promocion_envios e where e.promocion_id = p_id and e.canal = v_canal and e.profile_id = d.id) then v_ya := v_ya + 1; continue; end if;
      if v_canal = 'correo' then
        if nullif(lower(btrim(coalesce(d.email, ''))), '') is null then
          insert into public.promocion_envios (promocion_id, canal, profile_id, estado, created_by) values (p_id, 'correo', d.id, 'sin_correo', auth.uid());
          v_sin_correo := v_sin_correo + 1; continue;
        end if;
        perform public._comm_encolar_cuenta('promo:' || p_id::text || ':' || d.id::text, 'promocion', d.id, tx || jsonb_build_object('promocion_id', p_id));
        insert into public.promocion_envios (promocion_id, canal, profile_id, estado, created_by) values (p_id, 'correo', d.id, 'encolado', auth.uid());
        v_n_correo := v_n_correo + 1;
      else
        begin
          v_conv := (public.cc_abrir_conversacion(null, d.id) ->> 'conversation_id')::uuid;
          perform public.cc_enviar_mensaje(v_conv, 'system', null, null, 'promo:' || p_id::text, v_chat);
          insert into public.promocion_envios (promocion_id, canal, profile_id, estado, created_by) values (p_id, 'chat', d.id, 'entregado', auth.uid());
          v_n_chat := v_n_chat + 1;
        exception when others then
          insert into public.promocion_envios (promocion_id, canal, profile_id, estado, detalle, created_by) values (p_id, 'chat', d.id, 'sin_conversacion', left(sqlerrm, 200), auth.uid());
        end;
      end if;
    end loop;
  end loop;
  perform set_config('app.trusted', v_trusted, true);
  perform public.log_audit('Promoción enviada', p.nombre, format('canales %s · audiencia %s · correo %s · chat %s · sin correo %s · ya enviados %s', array_to_string(p_canales, ','), v_audiencia, v_n_correo, v_n_chat, v_sin_correo, v_ya),
                           case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return jsonb_build_object('audiencia', v_audiencia, 'correo', v_n_correo, 'chat', v_n_chat, 'sin_correo', v_sin_correo, 'ya_enviados', v_ya, 'texto', tx ->> 'texto');
end;
$$;

create or replace function public.promocion_difusion_previa(p_id uuid, p_vendedor uuid default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_listas uuid[]; v_aud int; v_sin int; tx jsonb;
begin
  if not public._promo_puede_administrar() then return null; end if;
  select listas into v_listas from public.promociones where id = p_id;
  select count(*), count(*) filter (where nullif(btrim(coalesce(pr.email, '')), '') is null) into v_aud, v_sin
    from public.profiles pr join public.customers c on c.profile_id = pr.id and c.active
   where pr.role_id = 'doctor' and pr.active and pr.verified
     and (v_listas is null or pr.price_list_id = any (v_listas))
     and (p_vendedor is null or exists (select 1 from public.cc_cartera k where k.profile_id = pr.id and k.seller_profile_id = p_vendedor));
  tx := public._promo_texto(p_id);
  return jsonb_build_object('texto', tx ->> 'texto', 'chat_texto', '[promo:' || p_id::text || ']' || E'\n' || (tx ->> 'texto'), 'datos', tx || jsonb_build_object('promocion_id', p_id),
    'audiencia', v_aud, 'sin_correo', v_sin,
    'enviados', (select jsonb_build_object('correo', count(*) filter (where canal = 'correo' and estado = 'encolado'), 'chat', count(*) filter (where canal = 'chat' and estado = 'entregado')) from public.promocion_envios e where e.promocion_id = p_id));
end;
$$;

-- Tarjeta de promoción en el chat del doctor: lo que necesita el portal para pintarla (solo si sigue vigente y aplica a su lista).
create function public.promo_tarjeta(p_id uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select case when exists (select 1 from public.promociones p where p.id = p_id and p.activa and public._promo_hoy() between p.desde and p.hasta
                              and (p.listas is null or (public.auth_role() <> 'doctor') or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.price_list_id = any (p.listas))))
                and auth.uid() is not null and public.puede_ver_precio()
              then public._promo_texto(p_id) - 'texto' end
$$;
alter function public.promo_tarjeta(uuid) owner to postgres;
revoke all on function public.promo_tarjeta(uuid) from public, anon;
grant execute on function public.promo_tarjeta(uuid) to authenticated;

do $post$ begin
  if has_function_privilege('anon', 'public.promo_tarjeta(uuid)', 'execute') then raise exception 'PROMO-MARKETING: permisos inesperados'; end if;
end $post$;
