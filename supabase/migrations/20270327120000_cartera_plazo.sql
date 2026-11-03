-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CARTERA CON PLAZO (3 nov 2026, dueño): "cuando le cae un prospecto a un vendedor se queda con él [6 meses]; durante ese
-- tiempo tiene que hacer la lucha por venderle y que recompre; si después el sistema detecta que no ha comprado, se le da
-- la oportunidad a otro vendedor". "Se les avise cada mes que tal cliente no ha comprado y cuántos días les faltan… el
-- chiste es fomentar que los vendedores vendan y la competitividad."
-- Decisiones (AskUserQuestion 3 nov): aplica también a la cartera actual con el reloj desde HOY; al vencer vuelve al
-- reparto por turno; renueva el plazo un pedido PAGADO. Plazo: 180 días (cc_atencion_config.cartera_plazo_dias).
--   · plazo_desde en cc_cartera / cc_cartera_clientes y la nueva cc_cartera_prospectos (contactos de WhatsApp sin ficha
--     ni cuenta): vence = plazo_desde + plazo. Cada pedido pagado lo reinicia.
--   · Quien ATIENDE (asesoría iniciada) a alguien sin vendedor vigente se lo queda (cuenta, ficha o prospecto). Gana la
--     cartera: si ya tiene vendedor, no cambia. Al ligarse un prospecto a su ficha o cuenta, su vendedor y su plazo pasan.
--   · El ruteo, el responsable de los avisos y "Mis conversaciones" leen también la cartera de prospectos.
--   · Diario: aviso a cada vendedor al cumplir cada mes sin compra (30, 60, 90…) y 7 días antes de vencer; al vencer se
--     libera (historial + aviso) y la siguiente vez que escriba entra al reparto.
--   · cc_cartera_eventos: asignado / renovado / liberado, para el tablero de competencia entre vendedores.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_cartera_prospectos') is not null then raise exception 'CARTERA-PLAZO: ya aplicada'; end if;
  if to_regprocedure('public._cc_vendedor_conv(uuid)') is null or to_regprocedure('public._cc_rutear(uuid)') is null
     or to_regprocedure('public._cc_responsable_comercial(uuid)') is null or to_regprocedure('public._cartera_cliente_al_ligar()') is null then
    raise exception 'CARTERA-PLAZO: faltan MIS-CONVERSACIONES, el ruteo o la cartera de clientes'; end if;
  if position('    elsif c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then s := public._cc_vendedor_de_cliente(c.customer_id);' in pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = 0
     or position('    case when public._cc_vendedor_elegible(c.seller_profile_id, false) then c.seller_profile_id end,' in pg_get_functiondef('public._cc_responsable_comercial(uuid)'::regprocedure)) = 0
     or position('values (new.profile_id, k.seller_profile_id, now(), k.asignado_por, ''Heredado del cliente al ligar su cuenta'');' in pg_get_functiondef('public._cartera_cliente_al_ligar()'::regprocedure)) = 0 then
    raise exception 'CARTERA-PLAZO: el ruteo, el responsable o la herencia de cartera cambiaron; revisar los parches'; end if;
end $pre$;

alter table public.cc_atencion_config add column cartera_plazo_dias integer not null default 180 check (cartera_plazo_dias between 30 and 730);
-- El reloj de lo que ya está asignado empieza HOY (decisión del dueño).
alter table public.cc_cartera add column plazo_desde timestamptz not null default now();
alter table public.cc_cartera_clientes add column plazo_desde timestamptz not null default now();

create table public.cc_cartera_prospectos (
  visitor_id        uuid primary key references public.cc_visitors(id) on delete cascade,
  seller_profile_id uuid not null references public.profiles(id) on delete cascade,
  asignado_at       timestamptz not null default now(),
  plazo_desde       timestamptz not null default now(),
  motivo            text
);
comment on table public.cc_cartera_prospectos is 'CARTERA-PLAZO · vendedor de un contacto sin ficha ni cuenta (p. ej. WhatsApp) mientras dure su plazo.';
create index ix_cc_cartera_prospectos_seller on public.cc_cartera_prospectos (seller_profile_id);

create table public.cc_cartera_eventos (
  id                bigserial primary key,
  seller_profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo              text not null check (tipo in ('asignado', 'renovado', 'liberado')),
  profile_id        uuid, customer_id uuid, visitor_id uuid,
  dias_sin_compra   integer,
  created_at        timestamptz not null default now()
);
create index ix_cc_cartera_eventos on public.cc_cartera_eventos (seller_profile_id, tipo, created_at);
alter table public.cc_cartera_prospectos enable row level security;
alter table public.cc_cartera_eventos enable row level security;
revoke all on public.cc_cartera_prospectos, public.cc_cartera_eventos from public, anon, authenticated;

create function public._cc_cartera_plazo() returns integer language sql stable set search_path = public as
$$ select coalesce((select cartera_plazo_dias from public.cc_atencion_config where id = 1), 180) $$;

-- Vendedor de un prospecto (contacto sin ficha ni cuenta), mientras su plazo siga vigente.
create function public._cc_vendedor_de_prospecto(p_visitor uuid) returns uuid language sql stable security definer set search_path = public as
$$ select k.seller_profile_id from public.cc_cartera_prospectos k where k.visitor_id = p_visitor and now() < k.plazo_desde + make_interval(days => public._cc_cartera_plazo()) $$;

-- Responsable comercial de la conversación: la cartera (cuenta, ficha o prospecto). Ya no basta con haberla atendido una
-- vez: eso ahora deja al vendedor en la cartera con su plazo (ver _cc_cartera_al_atender).
create or replace function public._cc_vendedor_conv(p_conv uuid) returns uuid language sql stable security definer set search_path = public as
$$
  select coalesce((select k.seller_profile_id from public.cc_cartera k where c.profile_id is not null and k.profile_id = c.profile_id),
                  case when c.customer_id is not null then public._cc_vendedor_de_cliente(c.customer_id) end,
                  case when c.profile_id is null and c.customer_id is null then public._cc_vendedor_de_prospecto(c.visitor_id) end)
    from public.cc_conversations c where c.id = p_conv
$$;

-- Días que le quedan al vendedor responsable con el dueño de esta conversación (null si no hay cartera).
create function public._cc_cartera_dias_conv(p_conv uuid) returns integer language sql stable security definer set search_path = public as
$$
  select ceil(extract(epoch from (d + make_interval(days => public._cc_cartera_plazo()) - now())) / 86400)::int
    from (select coalesce((select k.plazo_desde from public.cc_cartera k where c.profile_id is not null and k.profile_id = c.profile_id),
                          (select k.plazo_desde from public.cc_cartera_clientes k where c.profile_id is null and c.customer_id is not null and k.customer_id = c.customer_id),
                          (select k.plazo_desde from public.cc_cartera_prospectos k where c.profile_id is null and c.customer_id is null and k.visitor_id = c.visitor_id)) d
            from public.cc_conversations c where c.id = p_conv) x
   where d is not null
$$;

-- ── Lo atendió: se lo queda (si nadie lo tiene) ──
create function public._cc_cartera_al_atender() returns trigger language plpgsql security definer set search_path = public as
$$
declare c record; v_ok boolean;
begin
  if new.actor_profile_id is null then return new; end if;
  if not coalesce((select reparto_fija_cartera from public.cc_atencion_config where id = 1), true) then return new; end if;
  select p.role_id = 'pos' and not coalesce(p.interna, false) into v_ok from public.profiles p where p.id = new.actor_profile_id;
  if not coalesce(v_ok, false) then return new; end if;
  select * into c from public.cc_conversations where id = new.conversation_id;
  if not found or public._cc_vendedor_conv(c.id) is not null then return new; end if;   -- gana la cartera
  -- El reparto fija su propia cartera al iniciar (cc_iniciar_asesoria, con su motivo e historial): no se duplica aquí.
  if c.ruteo_motivo = 'reparto' and c.profile_id is not null then return new; end if;
  if c.profile_id is not null then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (c.profile_id, new.actor_profile_id, now(), new.actor_profile_id, 'Atendió su asesoría') on conflict (profile_id) do nothing;
    if found then insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (c.profile_id, null, new.actor_profile_id, new.actor_profile_id, 'Atendió su asesoría'); end if;
  elsif c.customer_id is not null then
    insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (c.customer_id, new.actor_profile_id, now(), new.actor_profile_id, 'Atendió su asesoría') on conflict (customer_id) do nothing;
    if found then insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (c.customer_id, null, new.actor_profile_id, new.actor_profile_id, 'Atendió su asesoría'); end if;
  elsif c.visitor_id is not null then
    -- Un plazo vencido se reemplaza (el contacto ya estaba libre).
    insert into public.cc_cartera_prospectos (visitor_id, seller_profile_id, motivo) values (c.visitor_id, new.actor_profile_id, 'Atendió su asesoría')
    on conflict (visitor_id) do update set seller_profile_id = excluded.seller_profile_id, asignado_at = now(), plazo_desde = now(), motivo = excluded.motivo
      where now() >= cc_cartera_prospectos.plazo_desde + make_interval(days => public._cc_cartera_plazo());
  else return new;
  end if;
  insert into public.cc_cartera_eventos (seller_profile_id, tipo, profile_id, customer_id, visitor_id)
  values (new.actor_profile_id, 'asignado', c.profile_id, case when c.profile_id is null then c.customer_id end, case when c.profile_id is null and c.customer_id is null then c.visitor_id end);
  return new;
exception when others then
  raise warning 'CARTERA-PLAZO: no se fijó la cartera (%): la asesoría sigue', sqlerrm;
  return new;
end;
$$;
create trigger cc_cartera_al_atender after insert on public.cc_conversation_events for each row
  when (new.tipo = 'human_started' and new.actor_type = 'seller') execute function public._cc_cartera_al_atender();

-- ── El prospecto se liga a su ficha o a su cuenta: su vendedor y su plazo pasan con él ──
create function public._cc_cartera_prospecto_al_ligar() returns trigger language plpgsql security definer set search_path = public as
$$
declare k public.cc_cartera_prospectos;
begin
  if new.visitor_id is null or (new.customer_id is not distinct from old.customer_id and new.profile_id is not distinct from old.profile_id) then return new; end if;
  select * into k from public.cc_cartera_prospectos where visitor_id = new.visitor_id and now() < plazo_desde + make_interval(days => public._cc_cartera_plazo());
  if not found then return new; end if;
  if new.profile_id is not null then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo, plazo_desde)
    values (new.profile_id, k.seller_profile_id, now(), k.seller_profile_id, 'Era su prospecto', k.plazo_desde) on conflict (profile_id) do nothing;
  elsif new.customer_id is not null then
    insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo, plazo_desde)
    values (new.customer_id, k.seller_profile_id, now(), k.seller_profile_id, 'Era su prospecto', k.plazo_desde) on conflict (customer_id) do nothing;
  else return new;
  end if;
  delete from public.cc_cartera_prospectos where visitor_id = new.visitor_id;
  return new;
end;
$$;
create trigger cc_cartera_prospecto_al_ligar after update of customer_id, profile_id on public.cc_conversations for each row execute function public._cc_cartera_prospecto_al_ligar();

-- ── Un pedido pagado reinicia el plazo de su vendedor ──
create function public._cc_cartera_renovar() returns trigger language plpgsql security definer set search_path = public as
$$
declare v_s uuid; v_desde timestamptz;
begin
  if new.payment_status <> 'paid' or (tg_op = 'UPDATE' and old.payment_status = 'paid') or new.status = 'cancelled' then return new; end if;
  if new.doctor_id is not null then
    update public.cc_cartera k set plazo_desde = now() from (select plazo_desde p0 from public.cc_cartera where profile_id = new.doctor_id) x
     where k.profile_id = new.doctor_id returning k.seller_profile_id, x.p0 into v_s, v_desde;
  end if;
  if v_s is null and new.customer_id is not null then
    update public.cc_cartera_clientes k set plazo_desde = now() from (select plazo_desde p0 from public.cc_cartera_clientes where customer_id = new.customer_id) x
     where k.customer_id = new.customer_id returning k.seller_profile_id, x.p0 into v_s, v_desde;
  end if;
  if v_s is not null then
    insert into public.cc_cartera_eventos (seller_profile_id, tipo, profile_id, customer_id, dias_sin_compra)
    values (v_s, 'renovado', new.doctor_id, new.customer_id, floor(extract(epoch from (now() - v_desde)) / 86400)::int);
  end if;
  return new;
exception when others then
  raise warning 'CARTERA-PLAZO: no se renovó el plazo (%): el pedido sigue', sqlerrm;
  return new;
end;
$$;
create trigger cc_cartera_renovar after insert or update of payment_status on public.orders for each row execute function public._cc_cartera_renovar();

-- ── Ruteo, responsable de avisos y herencia al ligar la cuenta: también la cartera de prospectos / el plazo ──
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure);
  d := replace(d, '    elsif c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then s := public._cc_vendedor_de_cliente(c.customer_id);',
    '    elsif c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then s := public._cc_vendedor_de_cliente(c.customer_id);
    -- CARTERA-PLAZO · el prospecto que atendió un vendedor sigue con él mientras dure su plazo.
    elsif c.customer_id is null and public._cc_vendedor_elegible(public._cc_vendedor_de_prospecto(c.visitor_id), false) then s := public._cc_vendedor_de_prospecto(c.visitor_id);');
  execute d;
  d := pg_get_functiondef('public._cc_responsable_comercial(uuid)'::regprocedure);
  d := replace(d, '    case when public._cc_vendedor_elegible(c.seller_profile_id, false) then c.seller_profile_id end,',
    '    case when c.profile_id is null and c.customer_id is null and public._cc_vendedor_elegible(public._cc_vendedor_de_prospecto(c.visitor_id), false) then public._cc_vendedor_de_prospecto(c.visitor_id) end,
    case when public._cc_vendedor_elegible(c.seller_profile_id, false) then c.seller_profile_id end,');
  execute d;
  d := pg_get_functiondef('public._cartera_cliente_al_ligar()'::regprocedure);
  d := replace(d, 'insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (new.profile_id, k.seller_profile_id, now(), k.asignado_por, ''Heredado del cliente al ligar su cuenta'');',
    'insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo, plazo_desde)
    values (new.profile_id, k.seller_profile_id, now(), k.asignado_por, ''Heredado del cliente al ligar su cuenta'', k.plazo_desde);');
  execute d;
  -- "Mis conversaciones" dice cuántos días le quedan.
  d := pg_get_functiondef('public.cc_mis_conversaciones()'::regprocedure);
  d := replace(d, '''prospecto'', c.profile_id is null and c.customer_id is null,', '''prospecto'', c.profile_id is null and c.customer_id is null, ''dias_restantes'', public._cc_cartera_dias_conv(c.id),');
  execute d;
end $patch$;

-- ── Lo que ya atendieron antes de hoy sin quedar en cartera: se les queda, con el reloj desde hoy ──
insert into public.cc_cartera_prospectos (visitor_id, seller_profile_id, motivo)
select distinct on (c.visitor_id) c.visitor_id, c.ultimo_asesor_id, 'Lo atendió antes del plazo (3 nov 2026)'
  from public.cc_conversations c join public.profiles p on p.id = c.ultimo_asesor_id
 where c.profile_id is null and c.customer_id is null and c.visitor_id is not null and p.role_id = 'pos' and p.active and not coalesce(p.interna, false)
 order by c.visitor_id, c.ultimo_asesor_at desc nulls last
on conflict (visitor_id) do nothing;
insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo)
select distinct on (c.customer_id) c.customer_id, c.ultimo_asesor_id, now(), c.ultimo_asesor_id, 'Lo atendió antes del plazo (3 nov 2026)'
  from public.cc_conversations c join public.profiles p on p.id = c.ultimo_asesor_id join public.customers cu on cu.id = c.customer_id
 where c.profile_id is null and cu.profile_id is null and p.role_id = 'pos' and p.active and not coalesce(p.interna, false)
   and not exists (select 1 from public.cc_cartera_clientes k where k.customer_id = c.customer_id)
 order by c.customer_id, c.ultimo_asesor_at desc nulls last
on conflict (customer_id) do nothing;
insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
select distinct on (c.profile_id) c.profile_id, c.ultimo_asesor_id, now(), c.ultimo_asesor_id, 'Lo atendió antes del plazo (3 nov 2026)'
  from public.cc_conversations c join public.profiles p on p.id = c.ultimo_asesor_id
 where c.profile_id is not null and p.role_id = 'pos' and p.active and not coalesce(p.interna, false)
   and not exists (select 1 from public.cc_cartera k where k.profile_id = c.profile_id)
 order by c.profile_id, c.ultimo_asesor_at desc nulls last
on conflict (profile_id) do nothing;

-- ── La cartera de cada quien con sus plazos (vendedor: la suya; jefe de ventas y Dirección: todas) ──
create function public._cc_cartera_filas() returns table (seller uuid, tipo text, profile_id uuid, customer_id uuid, visitor_id uuid, nombre text, telefono text, plazo_desde timestamptz)
  language sql stable security definer set search_path = public as
$$
  select k.seller_profile_id, 'cuenta', k.profile_id, null::uuid, null::uuid, coalesce(pr.meta ->> 'name', pr.full_name), (select cu.phone from public.customers cu where cu.profile_id = k.profile_id order by cu.created_at limit 1), k.plazo_desde
    from public.cc_cartera k join public.profiles pr on pr.id = k.profile_id
  union all
  select k.seller_profile_id, 'ficha', null, k.customer_id, null, cu.full_name, cu.phone, k.plazo_desde
    from public.cc_cartera_clientes k join public.customers cu on cu.id = k.customer_id where cu.active
  union all
  select k.seller_profile_id, 'prospecto', null, null, k.visitor_id,
         coalesce((select r.nombre from public.cc_prerregistros r where r.visitor_id = k.visitor_id), (select 'WhatsApp …' || right(w.wa_id, 4) || coalesce(' · ' || w.nombre, '') from public.cc_wa_contactos w where w.visitor_id = k.visitor_id limit 1), 'Prospecto'),
         (select w.wa_id from public.cc_wa_contactos w where w.visitor_id = k.visitor_id limit 1), k.plazo_desde
    from public.cc_cartera_prospectos k
$$;

create function public.cc_cartera_plazos(p_vendedor uuid default null, p_dias integer default 60) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_todos boolean; v_plazo int := public._cc_cartera_plazo();
begin
  if v_uid is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_todos := public.auth_role() = 'admin' or public._jefe_ventas();
  return jsonb_build_object('plazo_dias', v_plazo, 'clientes', coalesce((
    select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'profile_id', f.profile_id, 'customer_id', f.customer_id, 'visitor_id', f.visitor_id, 'nombre', f.nombre, 'telefono', f.telefono,
             'dias_sin_compra', floor(extract(epoch from (now() - f.plazo_desde)) / 86400)::int,
             'dias_restantes', ceil(extract(epoch from (f.plazo_desde + make_interval(days => v_plazo) - now())) / 86400)::int,
             'vence', (f.plazo_desde + make_interval(days => v_plazo))::date,
             'vendedor', case when v_todos then public._cc_nombre_personal(f.seller) end) order by f.plazo_desde, f.nombre)
      from public._cc_cartera_filas() f
     where (case when v_todos then (p_vendedor is null or f.seller = p_vendedor) else f.seller = v_uid end)
       and now() < f.plazo_desde + make_interval(days => v_plazo)
       and f.plazo_desde + make_interval(days => v_plazo) <= now() + make_interval(days => greatest(1, least(coalesce(p_dias, 60), 730)))), '[]'::jsonb));
end;
$$;

-- Tablero de competencia: números por vendedor, sin datos de los clientes de otros. Lo ve todo el equipo de ventas.
create function public.cc_cartera_ranking() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_plazo int := public._cc_cartera_plazo(); v_mes timestamptz := date_trunc('month', now() at time zone 'America/Mazatlan') at time zone 'America/Mazatlan';
begin
  if v_uid is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('vendedor', public._cc_nombre_personal(v.id), 'soy_yo', v.id = v_uid,
             'en_cartera', (select count(*) from public._cc_cartera_filas() f where f.seller = v.id and now() < f.plazo_desde + make_interval(days => v_plazo)),
             'por_vencer_30', (select count(*) from public._cc_cartera_filas() f where f.seller = v.id and now() < f.plazo_desde + make_interval(days => v_plazo) and f.plazo_desde + make_interval(days => v_plazo) <= now() + interval '30 days'),
             'compraron_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'renovado' and e.created_at >= v_mes),
             'rescatados_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'renovado' and e.dias_sin_compra >= 30 and e.created_at >= v_mes),
             'nuevos_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'asignado' and e.created_at >= v_mes),
             'perdidos_mes', (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'liberado' and e.created_at >= v_mes))
           order by (select count(*) from public.cc_cartera_eventos e where e.seller_profile_id = v.id and e.tipo = 'renovado' and e.created_at >= v_mes) desc, public._cc_nombre_personal(v.id))
      from public.profiles v
     where v.role_id = 'pos' and v.active and not coalesce(v.interna, false) and coalesce(v.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones'), '[]'::jsonb);
end;
$$;

-- ── Diario: avisos de cada mes sin compra y 7 días antes; al vencer, se libera ──
create function public.cc_cartera_plazos_job() returns jsonb language plpgsql security definer set search_path = public as
$$
declare v_plazo int := public._cc_cartera_plazo(); v_hoy text := (now() at time zone 'America/Mazatlan')::date::text; r record; n_lib int := 0; n_av int := 0;
begin
  -- 1 · Aviso por vendedor: quienes cumplen hoy un mes más sin comprar y quienes vencen en 7 días.
  for r in
    select f.seller,
           count(*) filter (where d.restantes = 7) vence7,
           count(*) filter (where d.sin > 0 and d.sin % 30 = 0 and d.restantes > 7) mes,
           min(d.restantes) filter (where d.sin > 0 and d.sin % 30 = 0 and d.restantes > 7) min_rest,
           (array_agg(f.nombre order by d.restantes) filter (where d.restantes = 7))[1] nombre7
      from public._cc_cartera_filas() f
      cross join lateral (select floor(extract(epoch from (now() - f.plazo_desde)) / 86400)::int sin,
                                 ceil(extract(epoch from (f.plazo_desde + make_interval(days => v_plazo) - now())) / 86400)::int restantes) d
     where now() < f.plazo_desde + make_interval(days => v_plazo)
     group by f.seller
    having count(*) filter (where (d.sin > 0 and d.sin % 30 = 0) or d.restantes = 7) > 0
  loop
    perform public._cc_notificar('cartera_plazo', null, array[r.seller], null,
      concat_ws(' ',
        case when r.vence7 > 0 then case when r.vence7 = 1 then coalesce(r.nombre7, 'Un cliente') || ' pasa a otro vendedor en 7 días si no te compra.' else r.vence7 || ' clientes pasan a otro vendedor en 7 días si no te compran.' end end,
        case when r.mes > 0 then r.mes || case when r.mes = 1 then ' cliente cumple' else ' clientes cumplen' end || ' otro mes sin comprar (al más cercano le quedan ' || r.min_rest || ' días).' end,
        'Véndeles para conservarlos.'),
      'cartera_plazos', 'cartera_plazo:' || r.seller::text || ':' || v_hoy);
    n_av := n_av + 1;
  end loop;

  -- 2 · Vencidos: se liberan (historial y evento) y se avisa a su vendedor.
  drop table if exists _lib;
  create temp table _lib on commit drop as
    select f.* from public._cc_cartera_filas() f where now() >= f.plazo_desde + make_interval(days => v_plazo);
  insert into public.cc_cartera_eventos (seller_profile_id, tipo, profile_id, customer_id, visitor_id, dias_sin_compra)
    select seller, 'liberado', profile_id, customer_id, visitor_id, floor(extract(epoch from (now() - plazo_desde)) / 86400)::int from _lib;
  insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
    select profile_id, seller, null, null, 'Venció: ' || v_plazo || ' días sin compra' from _lib where tipo = 'cuenta';
  insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo)
    select customer_id, seller, null, null, 'Venció: ' || v_plazo || ' días sin compra' from _lib where tipo = 'ficha';
  delete from public.cc_cartera k using _lib l where l.tipo = 'cuenta' and k.profile_id = l.profile_id and k.plazo_desde = l.plazo_desde;
  delete from public.cc_cartera_clientes k using _lib l where l.tipo = 'ficha' and k.customer_id = l.customer_id and k.plazo_desde = l.plazo_desde;
  delete from public.cc_cartera_prospectos k using _lib l where l.tipo = 'prospecto' and k.visitor_id = l.visitor_id and k.plazo_desde = l.plazo_desde;
  select count(*) into n_lib from _lib;
  for r in select seller, count(*) n from _lib group by seller loop
    perform public._cc_notificar('cartera_plazo', null, array[r.seller], null,
      r.n || case when r.n = 1 then ' cliente salió' else ' clientes salieron' end || ' de tu cartera: ' || v_plazo || ' días sin comprar. La próxima vez que escriban los atiende el siguiente vendedor en turno.',
      'cartera_plazos', 'cartera_liberado:' || r.seller::text || ':' || v_hoy);
  end loop;
  return jsonb_build_object('avisos', n_av, 'liberados', n_lib);
end;
$$;

revoke all on function public._cc_cartera_plazo(), public._cc_vendedor_de_prospecto(uuid), public._cc_cartera_dias_conv(uuid), public._cc_cartera_al_atender(),
  public._cc_cartera_prospecto_al_ligar(), public._cc_cartera_renovar(), public._cc_cartera_filas(), public.cc_cartera_plazos_job() from public, anon, authenticated;
revoke all on function public.cc_cartera_plazos(uuid, integer), public.cc_cartera_ranking() from public, anon;
grant execute on function public.cc_cartera_plazos(uuid, integer), public.cc_cartera_ranking() to authenticated;

do $cron$
declare r record;
begin
  for r in select jobid from cron.job where jobname = 'renovacell-cartera-plazos' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('renovacell-cartera-plazos'::text, '10 15 * * *'::text, 'select public.cc_cartera_plazos_job();'::text);   -- 8:10 a. m. en Culiacán
end $cron$;

do $post$ begin
  if to_regprocedure('public.cc_cartera_plazos_job()') is null or (select count(*) from cron.job where jobname = 'renovacell-cartera-plazos' and active) <> 1
     or position('_cc_vendedor_de_prospecto' in pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = 0
     or position('_cc_vendedor_de_prospecto' in pg_get_functiondef('public._cc_responsable_comercial(uuid)'::regprocedure)) = 0
     or position('k.plazo_desde' in pg_get_functiondef('public._cartera_cliente_al_ligar()'::regprocedure)) = 0
     or position('dias_restantes' in pg_get_functiondef('public.cc_mis_conversaciones()'::regprocedure)) = 0 then
    raise exception 'CARTERA-PLAZO: no quedó aplicada'; end if;
end $post$;
