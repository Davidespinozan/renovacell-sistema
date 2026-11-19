-- WHATSAPP RECONOCE AL CLIENTE POR SU CELULAR (19 nov 2026, dueño: «el sistema debería reconocer automáticamente al cliente
-- que hable por WhatsApp»). Cuando escribe un número que está en la ficha de UN cliente activo (o en varias fichas de la
-- MISMA vendedora), su conversación queda ligada a esa ficha: el equipo lo ve con su nombre y le llega directo a la
-- vendedora de su cartera (gana la cartera). Si el número está en fichas de vendedoras distintas, NO se adivina.
-- SEGURIDAD (R4-B1 sigue en pie): esto es solo para el EQUIPO. La IA sigue tratándolo como visitante (sin precios de lista
-- ni pedidos de esa cuenta): su identidad por WhatsApp solo la da el vínculo con código (cc_ia_identidad_canal).
do $pre$ begin
  if position(') z order by z.enviado_at desc limit 1;
    if not found then return new; end if;' in pg_get_functiondef('public._difwa_respuesta_tr()'::regprocedure)) = 0 then
    raise exception 'WA-RECONOCE: _difwa_respuesta_tr cambió; revisar'; end if;
end $pre$;

-- El cliente de un celular (10 dígitos): la ficha más completa si todas son de la misma vendedora; null si es ambiguo.
create or replace function public._wa_cliente_por_celular(p_tel text) returns uuid language sql stable security definer set search_path = public as
$$
  with cand as (
    select cu.id, public._cc_vendedor_de_cliente(cu.id) v, (cu.meta ? 'fiscal') fiscal, cu.email is not null correo, cu.created_at
      from public.customers cu
     where cu.active and length(coalesce(p_tel, '')) = 10
       and (right(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), 10) = p_tel
            or exists (select 1 from public.customer_phones t where t.customer_id = cu.id and t.activo and right(regexp_replace(t.numero, '\D', '', 'g'), 10) = p_tel)))
  select case when (select count(distinct v) from cand) <= 1 then (select id from cand order by fiscal desc, correo desc, created_at limit 1) end
$$;
revoke all on function public._wa_cliente_por_celular(text) from public, anon, authenticated;

do $patch$
declare d text := pg_get_functiondef('public._difwa_respuesta_tr()'::regprocedure);
begin
  d := replace(d, 'declare c record; k public.cc_wa_contactos; e record; v_seller uuid;', 'declare c record; k public.cc_wa_contactos; e record; v_seller uuid; v_cli uuid;');
  d := replace(d, ') z order by z.enviado_at desc limit 1;
    if not found then return new; end if;',
') z order by z.enviado_at desc limit 1;
    if not found then
      -- WA-RECONOCE · no respondía a una difusión ni a un aviso: ¿su celular es de un cliente?
      v_cli := public._wa_cliente_por_celular(right(k.wa_id, 10));
      if v_cli is null then return new; end if;
      update public.cc_conversations set customer_id = v_cli, updated_at = now() where id = c.id and customer_id is null;
      v_seller := public._cc_vendedor_de_cliente(v_cli);
      if v_seller is not null then
        perform public._cc_notificar(''wa_cliente_reconocido'', c.id, array[v_seller], null,
          format(''%s te escribió por WhatsApp (lo reconocimos por su celular).'', coalesce((select initcap(lower(full_name)) from public.customers where id = v_cli), ''Un cliente'')),
          ''asesorias'', ''wa_reconocido:'' || c.id::text);
      end if;
      return new;
    end if;');
  execute d;
end $patch$;

-- Conversaciones de WhatsApp que ya existen: se reconocen igual (gana la cartera) y se avisa a quien la recibe y a quien la tenía.
do $backfill$
declare r record; v_cli uuid; v_antes uuid; v_ahora uuid; v_nom text;
begin
  for r in select c.id, right(w.wa_id, 10) tel from public.cc_conversations c join public.cc_wa_contactos w on w.visitor_id = c.visitor_id
            where c.customer_id is null and c.profile_id is null and c.visitor_id is not null loop
    v_cli := public._wa_cliente_por_celular(r.tel);
    continue when v_cli is null;
    v_antes := public._cc_vendedor_conv(r.id);
    update public.cc_conversations set customer_id = v_cli, updated_at = now() where id = r.id and customer_id is null;
    v_ahora := public._cc_vendedor_conv(r.id);
    v_nom := coalesce((select initcap(lower(full_name)) from public.customers where id = v_cli), 'Un cliente');
    if v_ahora is not null and v_ahora is distinct from v_antes then
      perform public._cc_notificar('wa_cliente_reconocido', r.id, array[v_ahora], null,
        format('%s es de tu cartera: su conversación de WhatsApp ahora es tuya (lo reconocimos por su celular).', v_nom), 'asesorias', 'wa_reconocido:' || r.id::text);
      if v_antes is not null then
        perform public._cc_notificar('wa_cliente_reconocido', r.id, array[v_antes], null,
          format('La conversación de %s pasó a %s: es de su cartera.', v_nom, coalesce(public._cc_nombre_personal(v_ahora), 'su vendedora')), 'asesorias', 'wa_reconocido_antes:' || r.id::text);
      end if;
    end if;
  end loop;
end $backfill$;

do $post$ begin
  if position('WA-RECONOCE' in pg_get_functiondef('public._difwa_respuesta_tr()'::regprocedure)) = 0 then raise exception 'WA-RECONOCE: no quedó aplicada'; end if;
end $post$;
