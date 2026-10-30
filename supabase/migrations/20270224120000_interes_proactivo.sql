-- ============================================================================
-- INTERÉS PROACTIVO (30 oct 2026) · el dueño: "cuando el cliente busque en el catálogo algo, que la IA lo tome como señal
-- para hablarle y ofrecerle algo; o si le pica a ver la ficha técnica del producto también".
--   · Señal fuerte = abrió la ficha de un producto o buscó algo que no está en el catálogo (cc_actividad_catalogo).
--   · Se encola con un respiro de 2 minutos (si sigue mirando, cuenta lo último) y una tarea de cada minuto la atiende:
--     la IA le escribe en SU chat del portal con precios REALES del servidor (pieza, medio mayoreo, mayoreo, si se junta,
--     promoción vigente) y le ofrece cotizar o recomendar. Mensaje armado por el servidor: cero cifras inventadas.
--   · Nunca más de uno cada 24 h por doctor; nunca si un asesor ya lo está atendiendo ni si está escribiendo en el chat.
--   · Su vendedor de cartera recibe el aviso ("está viendo X; la IA ya le escribió") para darle seguimiento.
--   · Dirección puede apagarlo (cc_interes_config.activo) o cambiar las horas entre mensajes.
--   · cliente_interes_reciente: el vendedor ve en el expediente lo que el cliente buscó y miró (7 días).
-- ============================================================================

create table if not exists public.cc_interes_config (
  id boolean primary key default true check (id),
  activo boolean not null default true,
  horas_entre int not null default 24 check (horas_entre between 1 and 720),
  updated_at timestamptz not null default now());
insert into public.cc_interes_config (id) values (true) on conflict do nothing;
alter table public.cc_interes_config enable row level security;
revoke all on public.cc_interes_config from public, anon, authenticated;

create table if not exists public.cc_interes_cola (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  tipo        text not null check (tipo in ('ficha', 'sin_resultados')),
  product_id  uuid references public.products(id) on delete cascade,
  termino     text,
  listo_at    timestamptz not null,
  enviado_at  timestamptz,
  ultimo_envio_at timestamptz);
alter table public.cc_interes_cola enable row level security;
revoke all on public.cc_interes_cola from public, anon, authenticated;

-- ── 1 · La señal entra a la cola (el último interés manda; el respiro se reinicia) ───────────────
create or replace function public._cc_interes_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if new.tipo not in ('ficha', 'sin_resultados') then return new; end if;
  insert into public.cc_interes_cola (profile_id, tipo, product_id, termino, listo_at)
  values (new.profile_id, new.tipo, new.product_id, new.termino, now() + interval '2 minutes')
  on conflict (profile_id) do update set tipo = excluded.tipo, product_id = excluded.product_id, termino = excluded.termino,
    listo_at = excluded.listo_at, enviado_at = null;
  return new;
exception when others then
  raise warning 'INTERES: %', sqlerrm;   -- la señal nunca rompe el registro de actividad
  return new;
end;
$$;
drop trigger if exists cc_interes_senal on public.cc_actividad_catalogo;
create trigger cc_interes_senal after insert on public.cc_actividad_catalogo for each row execute function public._cc_interes_tr();

-- ── 2 · El texto (servidor): precios reales solo para quien puede verlos ──────────────────────────
create or replace function public._cc_dinero(p numeric) returns text language sql immutable as
$$ select '$' || case when p = trunc(p) then to_char(p, 'FM999,999,990') else to_char(p, 'FM999,999,990.00') end $$;

create or replace function public._cc_interes_texto(p_profile uuid, p_tipo text, p_product uuid, p_termino text) returns text
  language plpgsql stable security definer set search_path = public as
$$
declare v_nombre text; v_prod text; v_list uuid; v_precio boolean; v_pieza numeric; v_medio record; v_may record; v_junta boolean; v_promo jsonb; v_t text;
begin
  v_nombre := public._cc_primer_nombre((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = p_profile));
  v_t := '¡Hola' || coalesce(', ' || v_nombre, '') || '! ';
  if p_tipo = 'sin_resultados' then
    return v_t || 'Vi que buscaste «' || btrim(p_termino) || '» y no apareció en el catálogo. ¿Me cuentas qué necesitas? Te ayudo a encontrarlo o te sugiero una alternativa que sí manejemos.';
  end if;
  select name into v_prod from public.products where id = p_product;
  v_t := v_t || 'Vi que estás viendo ' || v_prod || '. ';
  v_precio := coalesce((public.cc_ia_contexto_actor(p_profile) ->> 'puede_precio')::boolean, false);
  if v_precio then
    select price_list_id into v_list from public.profiles where id = p_profile;
    v_pieza := public.precio_de(p_product, v_list, 1);
    select min_quantity, price into v_medio from public.product_volume_prices where product_id = p_product and active and nivel = 'medio' order by min_quantity limit 1;
    select min_quantity, price into v_may from public.product_volume_prices where product_id = p_product and active and nivel = 'mayoreo' order by min_quantity limit 1;
    v_junta := v_medio.min_quantity = 10;
    if v_medio.min_quantity is not null or v_may.min_quantity is not null then
      v_t := v_t || 'Te queda así: pieza ' || public._cc_dinero(v_pieza)
        || coalesce('; medio mayoreo desde ' || v_medio.min_quantity || ' piezas a ' || public._cc_dinero(v_medio.price) || case when v_junta then ' (puedes juntar piezas con otros productos de 10 para llegar)' else '' end, '')
        || coalesce('; mayoreo desde ' || v_may.min_quantity || ' a ' || public._cc_dinero(v_may.price) || ', y con eso todo tu pedido pasa a mayoreo', '') || '. ';
    elsif v_pieza is not null then
      v_t := v_t || 'Su precio es de ' || public._cc_dinero(v_pieza) || ' por pieza. ';
    end if;
    v_promo := public._promo_info(p_product, v_list);
    if v_promo is not null then
      v_t := v_t || 'Además está en ' || (v_promo ->> 'nombre') || ' hasta el ' || to_char((v_promo ->> 'hasta')::date, 'DD/MM') || '. ';
    end if;
    return v_t || '¿Te lo cotizo con las piezas que necesitas o te recomiendo algo que lo complemente?';
  end if;
  return v_t || '¿Quieres que te cuente sus características o te ayudo a resolver alguna duda?';
end;
$$;

-- ── 3 · Atender la cola (cada minuto) ────────────────────────────────────────────────────────────
create or replace function public.cc_interes_despachar() returns int
  language plpgsql security definer set search_path = public as
$$
declare cfg record; q record; v_conv uuid; cv record; v_texto text; v_cid text; v_seq bigint; v_seller uuid; v_cu uuid; n int := 0; v_nombre text; v_que text;
begin
  select * into cfg from public.cc_interes_config where id;
  if not coalesce(cfg.activo, false) then return 0; end if;
  for q in select * from public.cc_interes_cola where enviado_at is null and listo_at <= now() order by listo_at limit 50 for update skip locked loop
    -- Una vez cada N horas por doctor; solo doctores activos.
    if q.ultimo_envio_at is not null and q.ultimo_envio_at > now() - make_interval(hours => cfg.horas_entre) then
      update public.cc_interes_cola set enviado_at = now() where profile_id = q.profile_id; continue;
    end if;
    if public._cc_perfil_activo(q.profile_id) is distinct from 'doctor' then
      update public.cc_interes_cola set enviado_at = now() where profile_id = q.profile_id; continue;
    end if;
    v_conv := (public._cc_conversacion_de(null, q.profile_id) ->> 'conversation_id')::uuid;
    select * into cv from public.cc_conversations where id = v_conv;
    v_cu := public._cc_chk_customer(q.profile_id);
    v_seller := coalesce(cv.seller_profile_id, public._cc_vendedor_de_cliente(v_cu));
    v_nombre := coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = q.profile_id), 'Un cliente');
    v_que := case when q.tipo = 'ficha' then 'está viendo ' || (select name from public.products where id = q.product_id) else 'buscó «' || q.termino || '» y no lo encontró' end;
    -- Con un asesor atendiendo, o si escribió en el chat en los últimos 10 min, la IA no interrumpe: solo se avisa al vendedor.
    if cv.modo in ('human_assigned', 'human_active')
       or exists (select 1 from public.cc_messages m where m.conversation_id = v_conv and m.actor_type in ('doctor', 'visitor') and m.created_at > now() - interval '10 minutes') then
      if v_seller is not null then
        perform public._cc_notificar('interes', v_conv, array[v_seller], null, v_nombre || ' ' || v_que || ' en el catálogo.', 'asesorias', 'interes:' || q.profile_id || ':' || to_char(now(), 'YYYYMMDDHH24'));
      end if;
      update public.cc_interes_cola set enviado_at = now() where profile_id = q.profile_id; continue;
    end if;
    v_texto := public._cc_interes_texto(q.profile_id, q.tipo, q.product_id, q.termino);
    v_cid := 'tpl:interes:' || q.profile_id || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = v_conv returning ultimo_seq into v_seq;
    insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
    values (v_conv, v_seq, 'ai', v_cid, v_texto, md5(v_texto)) on conflict do nothing;
    if v_seller is not null then
      perform public._cc_notificar('interes', v_conv, array[v_seller], null, v_nombre || ' ' || v_que || ' en el catálogo; la IA ya le escribió para ofrecerle.', 'asesorias', 'interes:' || q.profile_id || ':' || to_char(now(), 'YYYYMMDDHH24'));
    end if;
    update public.cc_interes_cola set enviado_at = now(), ultimo_envio_at = now() where profile_id = q.profile_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── 4 · Lo que el vendedor ve en el expediente ───────────────────────────────────────────────────
create or replace function public.cliente_interes_reciente(p_customer uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_profile uuid;
begin
  if not coalesce(public._puede_perfil_cliente(p_customer), false) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select profile_id into v_profile from public.customers where id = p_customer;
  if v_profile is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x.cuando desc) from (
    select a.tipo, a.product_id, p.name producto, a.termino, max(a.at) cuando, count(*)::int veces
      from public.cc_actividad_catalogo a left join public.products p on p.id = a.product_id
     where a.profile_id = v_profile and a.at > now() - interval '7 days'
     group by a.tipo, a.product_id, p.name, a.termino order by max(a.at) desc limit 10) x), '[]'::jsonb);
end;
$$;

-- ── 5 · Dirección lo enciende/apaga ─────────────────────────────────────────────────────────────
create or replace function public.interes_config() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return (select jsonb_build_object('activo', activo, 'horas_entre', horas_entre) from public.cc_interes_config where id);
end; $$;
create or replace function public.interes_config_guardar(p_activo boolean, p_horas int) returns jsonb
  language plpgsql security definer set search_path = public as
$$ begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_interes_config set activo = coalesce(p_activo, activo), horas_entre = coalesce(p_horas, horas_entre), updated_at = now() where id;
  return public.interes_config();
end; $$;

alter function public._cc_interes_tr() owner to postgres;
alter function public._cc_interes_texto(uuid, text, uuid, text) owner to postgres;
alter function public.cc_interes_despachar() owner to postgres;
alter function public.cliente_interes_reciente(uuid) owner to postgres;
alter function public.interes_config() owner to postgres;
alter function public.interes_config_guardar(boolean, int) owner to postgres;
revoke all on function public._cc_interes_tr(), public._cc_dinero(numeric), public._cc_interes_texto(uuid, text, uuid, text), public.cc_interes_despachar(),
  public.cliente_interes_reciente(uuid), public.interes_config(), public.interes_config_guardar(boolean, int) from public, anon, authenticated;
grant execute on function public.cc_interes_despachar() to service_role;
grant execute on function public.cliente_interes_reciente(uuid), public.interes_config(), public.interes_config_guardar(boolean, int) to authenticated;

do $cron$
declare r record;
begin
  for r in select jobid from cron.job where jobname = 'renovacell-interes' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('renovacell-interes'::text, '* * * * *'::text, 'select public.cc_interes_despachar();'::text);
end $cron$;

do $post$ begin
  if to_regprocedure('public.cc_interes_despachar()') is null or (select count(*) from cron.job where jobname = 'renovacell-interes' and active) <> 1 then
    raise exception 'INTERES: no quedó aplicada'; end if;
end $post$;
