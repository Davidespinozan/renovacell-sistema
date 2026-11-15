-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PROSPECCIÓN · «A QUIÉN LLAMAR HOY» (15 nov 2026, lista del equipo: "revisar y detallar la prospección").
--   La cartera histórica (Odoo: Roberto 1,258, Alejandra 600; ninguno con cuenta en el portal) no tenía cómo
--   trabajarse: el embudo solo recibe a quien escribe. Ahora cada vendedora tiene su lista del día y anota el resultado
--   de cada llamada con un toque:
--     · interesado         → entra al embudo (oportunidad nueva, si no tenía una abierta)
--     · llamar_despues     → vuelve a su lista el día acordado (y queda en Pendientes con aviso)
--     · no_contesto        → vuelve en 2 días; al 3er intento seguido, en 30 días
--     · no_interesado      → descansa 90 días
--     · numero_equivocado / ya_no_ejerce → sale de la lista
--   Quién entra a la lista: clientes ACTIVOS de SU cartera, con teléfono, sin cuenta en el portal, sin oportunidad
--   abierta y sin conversación en los últimos 30 días. Primero lo acordado para hoy, luego los nunca llamados.
--   Registrar una llamada NO cambia la cartera ni su plazo (eso sigue siendo regla aparte).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.prospeccion_llamadas') is not null then raise exception 'PROSPECCION: ya aplicada'; end if;
  if to_regprocedure('public.crm_crear(uuid,text,numeric)') is null or to_regprocedure('public._crm_abierta(uuid,uuid,uuid)') is null
     or to_regprocedure('public.seguimiento_guardar(uuid,uuid,text,text,date)') is null or to_regprocedure('public._dif_alcance()') is null then
    raise exception 'PROSPECCION: faltan CRM, seguimientos o difusiones'; end if;
end $pre$;

create table public.prospeccion_llamadas (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id) on delete cascade,
  seller_profile_id uuid not null references public.profiles(id),
  resultado         text not null check (resultado in ('interesado', 'no_interesado', 'no_contesto', 'llamar_despues', 'numero_equivocado', 'ya_no_ejerce')),
  nota              text check (nota is null or length(nota) <= 500),
  proxima           date,
  created_at        timestamptz not null default now(),
  constraint ck_pros_proxima check (resultado <> 'llamar_despues' or proxima is not null)
);
comment on table public.prospeccion_llamadas is 'PROSPECCIÓN · cada llamada de la vendedora a un cliente de su cartera y su resultado.';
create index ix_pros_cliente on public.prospeccion_llamadas (customer_id, created_at desc);
create index ix_pros_vendedor on public.prospeccion_llamadas (seller_profile_id, created_at desc);
alter table public.prospeccion_llamadas enable row level security;   -- sin políticas: solo por los comandos
revoke all on table public.prospeccion_llamadas from public, anon, authenticated;

-- Cuándo vuelve a la lista según sus llamadas (null = nunca).
create function public._pros_disponible(p_customer uuid) returns date language plpgsql stable security definer set search_path = public as
$$
declare u public.prospeccion_llamadas; v_seguidas int;
begin
  select * into u from public.prospeccion_llamadas where customer_id = p_customer order by created_at desc limit 1;
  if not found then return current_date; end if;
  if u.resultado in ('numero_equivocado', 'ya_no_ejerce') then return null; end if;
  if u.resultado = 'llamar_despues' then return u.proxima; end if;
  if u.resultado = 'no_interesado' then return (u.created_at at time zone 'America/Mazatlan')::date + 90; end if;
  if u.resultado = 'interesado' then return (u.created_at at time zone 'America/Mazatlan')::date + 30; end if;
  -- no_contesto: cuántas seguidas desde la última llamada con otro resultado
  select count(*) into v_seguidas from public.prospeccion_llamadas l
   where l.customer_id = p_customer and l.created_at > coalesce((select max(x.created_at) from public.prospeccion_llamadas x where x.customer_id = p_customer and x.resultado <> 'no_contesto'), '-infinity');
  return (u.created_at at time zone 'America/Mazatlan')::date + case when v_seguidas >= 3 then 30 else 2 end;
end;
$$;

create function public._pros_telefono(p_customer uuid) returns text language sql stable security definer set search_path = public as
$$ select coalesce((select t.numero from public.customer_phones t where t.customer_id = p_customer and t.activo order by t.es_principal desc, t.created_at limit 1),
                   (select nullif(btrim(c.phone), '') from public.customers c where c.id = p_customer)) $$;

-- La lista del día. Una vendedora ve la suya; Dirección o el jefe de ventas eligen de quién (p_vendedor).
create function public.prospeccion_hoy(p_vendedor uuid default null, p_limite integer default 20) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare a record; v_seller uuid; v_hoy date := (now() at time zone 'America/Mazatlan')::date; v_lista jsonb; v_res jsonb;
begin
  select * into a from public._dif_alcance();
  v_seller := case when a.todos then coalesce(p_vendedor, a.uid) else a.uid end;
  with cand as (
    select cu.id, cu.full_name, cu.city, cu.tipo_cliente, cu.especialidad, public._pros_telefono(cu.id) tel, public._pros_disponible(cu.id) disp,
           (select l.resultado from public.prospeccion_llamadas l where l.customer_id = cu.id order by l.created_at desc limit 1) ultimo,
           (select l.created_at from public.prospeccion_llamadas l where l.customer_id = cu.id order by l.created_at desc limit 1) ultimo_at,
           (select l.nota from public.prospeccion_llamadas l where l.customer_id = cu.id and l.nota is not null order by l.created_at desc limit 1) ultima_nota,
           (select count(*) from public.prospeccion_llamadas l where l.customer_id = cu.id) intentos
      from public.cc_cartera_clientes k join public.customers cu on cu.id = k.customer_id
     where k.seller_profile_id = v_seller and cu.active and cu.profile_id is null
       and public._crm_abierta(cu.id, null, null) is null
       and not exists (select 1 from public.cc_conversations c where c.customer_id = cu.id and c.last_message_at > now() - interval '30 days')
  ), lista as (
    select * from cand where tel is not null and disp is not null and disp <= v_hoy
     order by case when ultimo = 'llamar_despues' then 0 when ultimo is null then 1 else 2 end, disp, ultimo_at nulls first, full_name
     limit least(greatest(coalesce(p_limite, 20), 1), 100)
  )
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', l.id, 'nombre', l.full_name, 'telefono', l.tel, 'ciudad', l.city, 'tipo', l.tipo_cliente,
           'especialidad', (select e.nombre from public.especialidades e where e.clave = l.especialidad), 'intentos', l.intentos, 'ultimo', l.ultimo,
           'ultimo_at', l.ultimo_at, 'ultima_nota', l.ultima_nota,
           'motivo', case when l.ultimo = 'llamar_despues' then 'Quedaste de llamarle hoy' when l.ultimo is null then 'Nunca se le ha llamado'
                          when l.ultimo = 'no_contesto' then 'No contestó la última vez' else 'Toca volver a intentar' end)), '[]'::jsonb)
    into v_lista from lista l;
  select jsonb_build_object(
      'hechas_hoy', count(*) filter (where (l.created_at at time zone 'America/Mazatlan')::date = v_hoy),
      'interesados_hoy', count(*) filter (where (l.created_at at time zone 'America/Mazatlan')::date = v_hoy and l.resultado = 'interesado'),
      'hechas_semana', count(*) filter (where l.created_at > now() - interval '7 days'),
      'interesados_semana', count(*) filter (where l.created_at > now() - interval '7 days' and l.resultado = 'interesado'))
    into v_res from public.prospeccion_llamadas l where l.seller_profile_id = v_seller;
  return jsonb_build_object('vendedor', v_seller, 'lista', v_lista, 'resumen', v_res,
    'por_llamar', (select count(*) from public.cc_cartera_clientes k join public.customers cu on cu.id = k.customer_id
                    where k.seller_profile_id = v_seller and cu.active and cu.profile_id is null and public._pros_telefono(cu.id) is not null
                      and public._pros_disponible(cu.id) <= v_hoy and public._crm_abierta(cu.id, null, null) is null));
end;
$$;

-- Anotar el resultado de una llamada.
create function public.prospeccion_registrar(p_customer uuid, p_resultado text, p_nota text default null, p_proxima date default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; v_seller uuid := public._cc_vendedor_de_cliente(p_customer); l public.prospeccion_llamadas; v_op jsonb; v_hoy date := (now() at time zone 'America/Mazatlan')::date;
        v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 500), '');
begin
  select * into a from public._dif_alcance();
  if not public._dif_es_mio(p_customer, a.todos, a.uid) then raise exception 'NO_AUTORIZADO: ese cliente no es de tu cartera' using errcode = 'insufficient_privilege'; end if;
  if p_resultado is null or p_resultado not in ('interesado', 'no_interesado', 'no_contesto', 'llamar_despues', 'numero_equivocado', 'ya_no_ejerce') then
    raise exception 'PROSPECCION_RESULTADO: resultado no válido' using errcode = 'check_violation'; end if;
  if p_resultado = 'llamar_despues' and (p_proxima is null or p_proxima < v_hoy or p_proxima > v_hoy + 365) then
    raise exception 'PROSPECCION_FECHA: elige el día en que le vas a volver a llamar' using errcode = 'check_violation'; end if;
  insert into public.prospeccion_llamadas (customer_id, seller_profile_id, resultado, nota, proxima)
  values (p_customer, coalesce(case when a.todos then v_seller end, a.uid), p_resultado, v_nota, case when p_resultado = 'llamar_despues' then p_proxima end)
  returning * into l;
  if p_resultado = 'interesado' and public._crm_abierta(p_customer, null, null) is null then
    v_op := public.crm_crear(p_customer, left(coalesce('Prospección: ' || v_nota, 'Prospección: interesado'), 120), null);
  end if;
  if p_resultado = 'llamar_despues' then
    perform public.seguimiento_guardar(p_customer, null, 'quedo_de_llamar', coalesce(v_nota, 'Volver a llamar (prospección)'), p_proxima);
  end if;
  return jsonb_build_object('id', l.id, 'resultado', l.resultado, 'oportunidad', v_op);
end;
$$;

-- Dirección y el jefe de ventas: cómo va cada vendedora.
create function public.prospeccion_resumen(p_dias integer default 7) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare a record; v_hoy date := (now() at time zone 'America/Mazatlan')::date;
begin
  select * into a from public._dif_alcance();
  if not a.todos then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('vendedor_id', s.id, 'vendedor', coalesce(s.meta ->> 'name', s.full_name),
            'hoy', (select count(*) from public.prospeccion_llamadas l where l.seller_profile_id = s.id and (l.created_at at time zone 'America/Mazatlan')::date = v_hoy),
            'periodo', (select count(*) from public.prospeccion_llamadas l where l.seller_profile_id = s.id and l.created_at > now() - make_interval(days => greatest(p_dias, 1))),
            'interesados', (select count(*) from public.prospeccion_llamadas l where l.seller_profile_id = s.id and l.resultado = 'interesado' and l.created_at > now() - make_interval(days => greatest(p_dias, 1))),
            'cartera', (select count(*) from public.cc_cartera_clientes k join public.customers cu on cu.id = k.customer_id where k.seller_profile_id = s.id and cu.active and cu.profile_id is null))
          order by coalesce(s.meta ->> 'name', s.full_name))
      from public.profiles s where s.active and exists (select 1 from public.cc_cartera_clientes k where k.seller_profile_id = s.id)), '[]'::jsonb);
end;
$$;

alter function public._pros_disponible(uuid) owner to postgres;
alter function public._pros_telefono(uuid) owner to postgres;
alter function public.prospeccion_hoy(uuid, integer) owner to postgres;
alter function public.prospeccion_registrar(uuid, text, text, date) owner to postgres;
alter function public.prospeccion_resumen(integer) owner to postgres;
revoke all on function public._pros_disponible(uuid), public._pros_telefono(uuid) from public, anon, authenticated;
revoke all on function public.prospeccion_hoy(uuid, integer), public.prospeccion_registrar(uuid, text, text, date), public.prospeccion_resumen(integer) from public, anon;
grant execute on function public.prospeccion_hoy(uuid, integer), public.prospeccion_registrar(uuid, text, text, date), public.prospeccion_resumen(integer) to authenticated;
