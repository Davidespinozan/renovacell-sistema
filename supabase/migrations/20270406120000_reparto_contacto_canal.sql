-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- REPARTO DE CONTACTOS DE CANAL (14 nov 2026, dueño: "Yamileth y Heliodoro salen en el embudo pero nunca les apareció la
-- conversación a los vendedores… es un super mega error"). Opción A elegida por el dueño.
--   Antes: un contacto de WhatsApp / Instagram / Facebook que solo hablaba con la IA no tenía vendedora (solo se asignaba
--   al pedir asesor) → ninguna lo veía en Conversaciones (21 en 30 días).
--   Ahora: con su PRIMER mensaje (o el primero sin responsable), si la conversación no tiene vendedora responsable
--   (_cc_vendedor_conv), se le asigna una con el MISMO turno rotativo del reparto (_cc_vendedor_turno: solo vendedoras
--   habilitadas para clientes nuevos) y queda en SU cartera con el plazo normal. La IA sigue atendiendo; la vendedora
--   recibe un aviso y lo ve en su lista. Gana siempre la cartera existente. Nunca rompe el mensaje (excepciones → aviso).
--   Excluye números 800 (bots de empresa). Al aplicarse reparte las conversaciones abiertas de 30 días sin responsable.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cc_reparto_contacto(uuid,boolean)') is not null then raise exception 'REPARTO-CONTACTO: ya aplicada'; end if;
  if to_regprocedure('public._cc_vendedor_turno(uuid[])') is null or to_regprocedure('public._cc_vendedor_conv(uuid)') is null
     or to_regprocedure('public._cc_contacto_conv(uuid)') is null or to_regprocedure('public._cc_notificar(text,uuid,uuid[],text[],text,text,text)') is null
     or to_regclass('public.cc_cartera_prospectos') is null or to_regclass('public.cc_cartera_eventos') is null then
    raise exception 'REPARTO-CONTACTO: faltan reparto, cartera o CONV-WHATSAPP'; end if;
end $pre$;

create function public._cc_reparto_contacto(p_conv uuid, p_avisar boolean default true) returns uuid language plpgsql security definer set search_path = public as
$$
declare c record; ct jsonb; v_seller uuid; v_tel text;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found or c.estado <> 'abierta' or c.visitor_id is null then return null; end if;
  if c.seller_profile_id is not null or public._cc_vendedor_conv(p_conv) is not null then return null; end if;   -- gana la cartera / ya atendida
  ct := public._cc_contacto_conv(p_conv);
  if ct ->> 'canal' is null then return null; end if;                                                            -- solo WhatsApp / Instagram / Facebook
  v_tel := regexp_replace(coalesce(ct ->> 'telefono', ''), '\D', '', 'g');
  if v_tel ~ '^(52)?1?800' then return null; end if;                                                              -- números 800: bots de empresa
  v_seller := public._cc_vendedor_turno('{}');
  if v_seller is null then return null; end if;                                                                   -- nadie habilitado: lo ve Dirección
  if c.profile_id is not null then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (c.profile_id, v_seller, now(), null, 'Contacto nuevo por ' || (ct ->> 'canal')) on conflict (profile_id) do nothing;
    if not found then return null; end if;
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (c.profile_id, null, v_seller, null, 'Contacto nuevo por ' || (ct ->> 'canal'));
  elsif c.customer_id is not null then
    insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (c.customer_id, v_seller, now(), null, 'Contacto nuevo por ' || (ct ->> 'canal')) on conflict (customer_id) do nothing;
    if not found then return null; end if;
    insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (c.customer_id, null, v_seller, null, 'Contacto nuevo por ' || (ct ->> 'canal'));
  else
    insert into public.cc_cartera_prospectos (visitor_id, seller_profile_id, motivo) values (c.visitor_id, v_seller, 'Contacto nuevo por ' || (ct ->> 'canal'))
    on conflict (visitor_id) do update set seller_profile_id = excluded.seller_profile_id, asignado_at = now(), plazo_desde = now(), motivo = excluded.motivo
      where now() >= cc_cartera_prospectos.plazo_desde + make_interval(days => public._cc_cartera_plazo());
    if not found then return null; end if;
  end if;
  insert into public.cc_cartera_eventos (seller_profile_id, tipo, profile_id, customer_id, visitor_id)
  values (v_seller, 'asignado', c.profile_id, case when c.profile_id is null then c.customer_id end, case when c.profile_id is null and c.customer_id is null then c.visitor_id end);
  -- La oportunidad del embudo que ya existía sin vendedora queda con ella.
  update public.crm_oportunidades set seller_profile_id = v_seller where conversation_id = p_conv and seller_profile_id is null and etapa not in ('ganado', 'perdido');
  if p_avisar then perform public._cc_notificar('contacto_asignado', p_conv, array[v_seller], null,
    format('Nuevo contacto de %s para ti: %s%s. El asistente lo está atendiendo; escríbele cuando quieras.',
           case ct ->> 'canal' when 'whatsapp' then 'WhatsApp' when 'instagram' then 'Instagram' else 'Facebook' end,
           coalesce(ct ->> 'nombre', 'sin nombre'), case when ct ->> 'telefono' is not null and ct ->> 'telefono' <> ct ->> 'nombre' then ' (' || (ct ->> 'telefono') || ')' else '' end),
    'asesorias', 'contacto_asignado:' || p_conv::text); end if;
  return v_seller;
end;
$$;
revoke all on function public._cc_reparto_contacto(uuid, boolean) from public, anon, authenticated;

create function public._cc_reparto_contacto_trg() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if new.actor_type = 'visitor' then
    begin
      perform public._cc_reparto_contacto(new.conversation_id);
    exception when others then
      raise warning 'REPARTO-CONTACTO: no se asignó vendedora (%): el mensaje sigue', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public._cc_reparto_contacto_trg() from public, anon, authenticated;
create trigger zz_reparto_contacto after insert on public.cc_messages for each row execute function public._cc_reparto_contacto_trg();

-- Las abiertas de 30 días sin responsable (las que nadie veía), en orden de llegada.
create temp table tmp_reparto_inicial (seller uuid) on commit drop;
do $backfill$
declare r record; n int := 0; v uuid; t record;
begin
  for r in select c.id from public.cc_conversations c
            where c.estado = 'abierta' and c.last_message_at > now() - interval '30 days' and c.seller_profile_id is null
              and public._cc_vendedor_conv(c.id) is null
            order by c.last_message_at loop
    v := public._cc_reparto_contacto(r.id, false);
    if v is not null then n := n + 1; insert into tmp_reparto_inicial values (v); end if;
  end loop;
  -- UN aviso por vendedora (no uno por contacto).
  for t in select seller, count(*) k from tmp_reparto_inicial group by seller loop
    perform public._cc_notificar('contacto_asignado', null, array[t.seller], null,
      format('Te asignamos %s contactos de WhatsApp / redes que solo atendía el asistente. Están en Conversaciones.', t.k), 'asesorias', 'contacto_asignado:inicial:' || t.seller::text);
  end loop;
  raise notice 'REPARTO-CONTACTO: % conversaciones repartidas', n;
end $backfill$;
