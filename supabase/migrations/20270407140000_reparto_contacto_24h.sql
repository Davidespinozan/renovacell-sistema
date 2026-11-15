-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- REPARTO DE CONTACTOS · 24 H PARA LA PRIMERA RESPUESTA (15 nov 2026, regla del dueño: "las 24 horas son para primera
-- respuesta; si la vendedora dentro de las 24 horas ya le respondió, entra la regla de los 6 meses").
--   Antes (20270406120000): el contacto nuevo de WhatsApp/IG/FB entraba DIRECTO a la cartera con 6 meses, contestara o no.
--   Ahora:
--   · cc_reparto_contacto     asignación PENDIENTE: la vendedora en turno lo ve y le escribe (cuenta como responsable en
--                             _cc_vendedor_conv), pero aún no es de su cartera.
--   · al responder            su primer mensaje lo pasa a SU cartera con el plazo normal desde ese momento (después aplican
--                             los avisos mensuales y el vencimiento de cc_cartera_plazos_job).
--   · sin respuesta en 24 h   pasa a la siguiente vendedora en turno (_cc_vendedor_turno, sin repetir), con aviso a las dos;
--                             sin nadie más disponible, se avisa a Dirección y queda libre. Cron cada 15 min.
--   · los repartidos el 14 nov que aún no tienen respuesta reciben 24 h nuevas desde hoy; el que sí la tiene se queda en
--     cartera con el plazo desde su primera respuesta.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_reparto_contacto') is not null then raise exception 'REPARTO-24H: ya aplicada'; end if;
  if to_regprocedure('public._cc_reparto_contacto(uuid,boolean)') is null or to_regprocedure('public._cc_vendedor_turno(uuid[])') is null then
    raise exception 'REPARTO-24H: falta el reparto de contactos'; end if;
end $pre$;

create table public.cc_reparto_contacto (
  conversation_id uuid primary key references public.cc_conversations(id) on delete cascade,
  seller_profile_id uuid not null references public.profiles(id),
  asignado_at timestamptz not null default now(),
  probados uuid[] not null default '{}'
);
alter table public.cc_reparto_contacto enable row level security;   -- sin políticas: solo funciones del servidor
revoke all on public.cc_reparto_contacto from anon, authenticated;

-- La vendedora con asignación pendiente cuenta como responsable (le aparece y puede escribirle). Gana la cartera.
create or replace function public._cc_vendedor_conv(p_conv uuid) returns uuid language sql stable security definer set search_path to 'public' as
$function$
  select coalesce((select k.seller_profile_id from public.cc_cartera k where c.profile_id is not null and k.profile_id = c.profile_id),
                  case when c.customer_id is not null then public._cc_vendedor_de_cliente(c.customer_id) end,
                  case when c.profile_id is null and c.customer_id is null then public._cc_vendedor_de_prospecto(c.visitor_id) end,
                  (select r.seller_profile_id from public.cc_reparto_contacto r where r.conversation_id = c.id))
    from public.cc_conversations c where c.id = p_conv
$function$;

-- Reparto: ya no fija cartera; deja la asignación pendiente de su primera respuesta.
create or replace function public._cc_reparto_contacto(p_conv uuid, p_avisar boolean default true) returns uuid
  language plpgsql security definer set search_path to 'public' as
$function$
declare c record; ct jsonb; v_seller uuid; v_tel text;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found or c.estado <> 'abierta' or c.visitor_id is null then return null; end if;
  if c.seller_profile_id is not null or public._cc_vendedor_conv(p_conv) is not null then return null; end if;   -- gana la cartera / ya asignada
  ct := public._cc_contacto_conv(p_conv);
  if ct ->> 'canal' is null then return null; end if;
  v_tel := regexp_replace(coalesce(ct ->> 'telefono', ''), '\D', '', 'g');
  if v_tel ~ '^(52)?1?800' then return null; end if;
  v_seller := public._cc_vendedor_turno('{}');
  if v_seller is null then return null; end if;
  insert into public.cc_reparto_contacto (conversation_id, seller_profile_id, asignado_at, probados) values (p_conv, v_seller, now(), array[v_seller])
  on conflict (conversation_id) do nothing;
  if not found then return null; end if;
  update public.crm_oportunidades set seller_profile_id = v_seller where conversation_id = p_conv and seller_profile_id is null and etapa not in ('ganado', 'perdido');
  if p_avisar then perform public._cc_notificar('contacto_asignado', p_conv, array[v_seller], null,
    format('Nuevo contacto de %s para ti: %s%s. Respóndele en menos de 24 h y queda en tu cartera; si no, pasa a otra vendedora.',
           case ct ->> 'canal' when 'whatsapp' then 'WhatsApp' when 'instagram' then 'Instagram' else 'Facebook' end,
           coalesce(ct ->> 'nombre', 'sin nombre'), case when ct ->> 'telefono' is not null and ct ->> 'telefono' <> ct ->> 'nombre' then ' (' || (ct ->> 'telefono') || ')' else '' end),
    'asesorias', 'contacto_asignado:' || p_conv::text || ':' || v_seller::text); end if;
  return v_seller;
end;
$function$;

-- Su primera respuesta: pasa a SU cartera con el plazo normal desde ahora.
create function public._cc_reparto_contacto_fijar(p_conv uuid, p_seller uuid, p_desde timestamptz) returns void language plpgsql security definer set search_path = public as
$$
declare c record;
begin
  select * into c from public.cc_conversations where id = p_conv;
  if not found then return; end if;
  if c.profile_id is not null then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo, plazo_desde)
    values (c.profile_id, p_seller, now(), p_seller, 'Respondió en menos de 24 h', p_desde) on conflict (profile_id) do nothing;
  elsif c.customer_id is not null then
    insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo, plazo_desde)
    values (c.customer_id, p_seller, now(), p_seller, 'Respondió en menos de 24 h', p_desde) on conflict (customer_id) do nothing;
  elsif c.visitor_id is not null then
    insert into public.cc_cartera_prospectos (visitor_id, seller_profile_id, motivo, plazo_desde) values (c.visitor_id, p_seller, 'Respondió en menos de 24 h', p_desde)
    on conflict (visitor_id) do update set seller_profile_id = excluded.seller_profile_id, asignado_at = now(), plazo_desde = excluded.plazo_desde, motivo = excluded.motivo
      where now() >= cc_cartera_prospectos.plazo_desde + make_interval(days => public._cc_cartera_plazo());
  end if;
  insert into public.cc_cartera_eventos (seller_profile_id, tipo, profile_id, customer_id, visitor_id)
  values (p_seller, 'asignado', c.profile_id, case when c.profile_id is null then c.customer_id end, case when c.profile_id is null and c.customer_id is null then c.visitor_id end);
  delete from public.cc_reparto_contacto where conversation_id = p_conv;
end;
$$;
revoke all on function public._cc_reparto_contacto_fijar(uuid, uuid, timestamptz) from public, anon, authenticated;

create function public._cc_reparto_contacto_respuesta_trg() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if new.actor_type = 'seller' and new.actor_profile_id is not null
     and exists (select 1 from public.cc_reparto_contacto r where r.conversation_id = new.conversation_id) then
    begin
      perform public._cc_reparto_contacto_fijar(new.conversation_id, new.actor_profile_id, now());
    exception when others then
      raise warning 'REPARTO-24H: no se fijó la cartera (%): el mensaje sigue', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public._cc_reparto_contacto_respuesta_trg() from public, anon, authenticated;
create trigger zz_reparto_contacto_respuesta after insert on public.cc_messages for each row execute function public._cc_reparto_contacto_respuesta_trg();

-- Sin respuesta en 24 h: a la siguiente en turno (sin repetir); sin nadie, aviso a Dirección.
create function public.cc_reparto_contacto_evaluar() returns jsonb language plpgsql security definer set search_path = public as
$$
declare r record; v_next uuid; n_pasa int := 0; n_libre int := 0; v_nombre text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not (public._cc_es_admin() or public._cc_es_service()) then
    raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  delete from public.cc_reparto_contacto rc using public.cc_conversations cv where cv.id = rc.conversation_id and cv.estado <> 'abierta';
  for r in select * from public.cc_reparto_contacto where asignado_at < now() - interval '24 hours' for update skip locked loop
    v_nombre := coalesce(public._cc_contacto_conv(r.conversation_id) ->> 'nombre', 'Un contacto');
    v_next := public._cc_vendedor_turno(r.probados);
    if v_next is null then
      delete from public.cc_reparto_contacto where conversation_id = r.conversation_id;
      perform public._cc_notificar('contacto_sin_respuesta', r.conversation_id, null, array['admin'],
        format('%s no recibió respuesta en 24 h y ya no hay más vendedoras disponibles. Asígnalo desde la Bandeja.', v_nombre), 'av_atencion',
        'contacto_sin_respuesta:' || r.conversation_id::text || ':' || extract(epoch from r.asignado_at)::bigint::text);
      n_libre := n_libre + 1;
    else
      update public.cc_reparto_contacto set seller_profile_id = v_next, asignado_at = now(), probados = probados || v_next where conversation_id = r.conversation_id;
      perform public._cc_notificar('contacto_asignado', r.conversation_id, array[v_next], null,
        format('Te pasamos a %s: no recibió respuesta en 24 h. Respóndele en menos de 24 h y queda en tu cartera.', v_nombre), 'asesorias',
        'contacto_asignado:' || r.conversation_id::text || ':' || v_next::text);
      perform public._cc_notificar('contacto_reasignado', r.conversation_id, array[r.seller_profile_id], null,
        format('%s pasó a %s porque no le respondiste en 24 h.', v_nombre, coalesce(public._cc_nombre_personal(v_next), 'otra vendedora')), 'asesorias',
        'contacto_reasignado:' || r.conversation_id::text || ':' || r.seller_profile_id::text);
      n_pasa := n_pasa + 1;
    end if;
  end loop;
  return jsonb_build_object('pasaron', n_pasa, 'sin_vendedora', n_libre);
end;
$$;
revoke all on function public.cc_reparto_contacto_evaluar() from public, anon;

select cron.schedule('renovacell-reparto-contacto', '*/15 * * * *', 'select public.cc_reparto_contacto_evaluar();');

-- Los del 14 nov: con respuesta → cartera desde su primera respuesta; sin respuesta → pendiente con 24 h nuevas.
do $backfill$
declare a record; v_resp timestamptz; n_ok int := 0; n_pend int := 0;
begin
  for a in
    select 'prospecto' t, k.seller_profile_id s, k.asignado_at, c.id conv, k.visitor_id, null::uuid customer_id, null::uuid profile_id
      from public.cc_cartera_prospectos k join public.cc_conversations c on c.visitor_id = k.visitor_id and c.profile_id is null and c.customer_id is null where k.motivo like 'Contacto nuevo por %'
    union all select 'ficha', k.seller_profile_id, k.asignado_at, c.id, null, k.customer_id, null
      from public.cc_cartera_clientes k join public.cc_conversations c on c.customer_id = k.customer_id where k.motivo like 'Contacto nuevo por %'
    union all select 'cuenta', k.seller_profile_id, k.asignado_at, c.id, null, null, k.profile_id
      from public.cc_cartera k join public.cc_conversations c on c.profile_id = k.profile_id where k.motivo like 'Contacto nuevo por %'
  loop
    select min(m.created_at) into v_resp from public.cc_messages m where m.conversation_id = a.conv and m.actor_type = 'seller' and m.actor_profile_id = a.s and m.created_at >= a.asignado_at;
    if v_resp is not null then
      if a.t = 'prospecto' then update public.cc_cartera_prospectos set plazo_desde = v_resp, motivo = 'Respondió en menos de 24 h' where visitor_id = a.visitor_id;
      elsif a.t = 'ficha' then update public.cc_cartera_clientes set plazo_desde = v_resp, motivo = 'Respondió en menos de 24 h' where customer_id = a.customer_id;
      else update public.cc_cartera set plazo_desde = v_resp, motivo = 'Respondió en menos de 24 h' where profile_id = a.profile_id; end if;
      n_ok := n_ok + 1;
    else
      if a.t = 'prospecto' then delete from public.cc_cartera_prospectos where visitor_id = a.visitor_id;
      elsif a.t = 'ficha' then delete from public.cc_cartera_clientes where customer_id = a.customer_id;
      else delete from public.cc_cartera where profile_id = a.profile_id; end if;
      insert into public.cc_reparto_contacto (conversation_id, seller_profile_id, asignado_at, probados) values (a.conv, a.s, now(), array[a.s]) on conflict (conversation_id) do nothing;
      n_pend := n_pend + 1;
    end if;
  end loop;
  raise notice 'REPARTO-24H: % se quedan en cartera (respondieron), % con 24 h nuevas', n_ok, n_pend;
end $backfill$;

do $post$ begin
  if to_regprocedure('public.cc_reparto_contacto_evaluar()') is null or has_function_privilege('authenticated', 'public._cc_reparto_contacto_fijar(uuid,uuid,timestamptz)', 'execute') then
    raise exception 'REPARTO-24H: no quedó aplicada'; end if;
end $post$;
