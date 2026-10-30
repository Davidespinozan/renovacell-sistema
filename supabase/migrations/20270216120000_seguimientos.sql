-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- HERRAMIENTAS DEL VENDEDOR · bloque C (30 oct 2026) · SEGUIMIENTOS. Los vendedores quieren "saber a qué cliente se le dejó
--   en qué estado… que le tienes que avisar algo en tantos días… para retomar la plática más fácil".
--   · cc_seguimientos: en qué quedó con un cliente (estado + nota) y cuándo retomarlo. Uno vigente por cliente y vendedor:
--     dejar uno nuevo cierra el anterior. Va ligado a la ficha (o a la conversación si aún no tiene ficha).
--   · Lo deja quien atiende: el vendedor del cliente o de la conversación, el jefe de ventas o Dirección.
--   · mis_seguimientos: vencidos, de hoy y próximos del vendedor (Dirección y el jefe ven los de todos con su vendedor).
--   · cc_seguimientos_avisar (cron cada 15 min): el día que toca, desde las 9:00 de Culiacán, una alerta al vendedor.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_seguimientos') is not null then raise exception 'BLOQUE-C: ya aplicada'; end if;
  if to_regprocedure('public._puede_perfil_cliente(uuid)') is null or to_regprocedure('public._cc_puede_ver_conv(uuid)') is null or to_regprocedure('public.hoy_local()') is null then
    raise exception 'BLOQUE-C: faltan BLOQUE-B (20270215), VINCULAR-CLIENTE o W1'; end if;
end $pre$;

create table public.cc_seguimientos (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references public.customers(id) on delete cascade,
  conversation_id   uuid references public.cc_conversations(id) on delete cascade,
  seller_profile_id uuid not null references public.profiles(id) on delete cascade,
  estado            text not null,
  nota              text,
  recordar_el       date not null,
  avisado_el        date,
  hecho_at          timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null,
  constraint ck_seg_a_quien check (customer_id is not null or conversation_id is not null),
  constraint ck_seg_estado check (estado in ('cotizacion_enviada', 'esperando_pago', 'lo_esta_pensando', 'quedo_de_llamar', 'volver_a_ofrecer', 'esperando_datos', 'otro')),
  constraint ck_seg_nota check (nota is null or length(nota) <= 500)
);
create index idx_seg_vigentes on public.cc_seguimientos (seller_profile_id, recordar_el) where hecho_at is null;
create index idx_seg_cliente on public.cc_seguimientos (customer_id) where hecho_at is null;
create index idx_seg_conv on public.cc_seguimientos (conversation_id) where hecho_at is null;
alter table public.cc_seguimientos enable row level security;   -- sin políticas: solo por las funciones
revoke all on public.cc_seguimientos from anon, authenticated;

-- ¿Quien llama puede dejar o ver el seguimiento de este cliente / esta conversación?
create function public._puede_seguimiento(p_customer uuid, p_conv uuid) returns boolean language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and public.auth_role() in ('admin', 'pos')
     and ((p_customer is not null and public._puede_perfil_cliente(p_customer)) or (p_conv is not null and public._cc_puede_ver_conv(p_conv))) $$;

create function public._seguimiento_json(s public.cc_seguimientos) returns jsonb language sql stable security definer set search_path = public as
$$ select jsonb_build_object('id', s.id, 'customer_id', s.customer_id, 'conversation_id', s.conversation_id, 'estado', s.estado, 'nota', s.nota,
     'recordar_el', s.recordar_el, 'hecho', s.hecho_at is not null, 'creado', s.created_at,
     'vendedor', public._cc_nombre_personal(s.seller_profile_id), 'es_mio', s.seller_profile_id = auth.uid(),
     'nombre', coalesce((select c.full_name from public.customers c where c.id = s.customer_id), public._cc_nombre_dueno(s.conversation_id)),
     'conversacion', coalesce(s.conversation_id, (select cc.id from public.cc_conversations cc join public.customers c on c.id = s.customer_id
                                                    where (cc.customer_id = c.id or (c.profile_id is not null and cc.profile_id = c.profile_id)) and cc.estado = 'abierta'
                                                    order by cc.last_message_at desc nulls last limit 1))) $$;

create function public.seguimiento_guardar(p_customer uuid, p_conv uuid, p_estado text, p_nota text, p_recordar date) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_cust uuid := p_customer; s public.cc_seguimientos;
begin
  if v_cust is null and p_conv is not null then select customer_id into v_cust from public.cc_conversations where id = p_conv; end if;   -- ya ligada: a su ficha
  if not public._puede_seguimiento(v_cust, p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_recordar is null or p_recordar < public.hoy_local() or p_recordar > public.hoy_local() + 365 then raise exception 'DATO_INVALIDO:fecha'; end if;
  if p_estado is null then raise exception 'DATO_INVALIDO:estado'; end if;
  -- Uno vigente por cliente (o conversación) y vendedor: el nuevo cierra el anterior.
  update public.cc_seguimientos set hecho_at = now()
   where hecho_at is null and seller_profile_id = v_uid
     and ((v_cust is not null and customer_id = v_cust) or (v_cust is null and conversation_id = p_conv));
  insert into public.cc_seguimientos (customer_id, conversation_id, seller_profile_id, estado, nota, recordar_el, created_by)
  values (v_cust, case when v_cust is null then p_conv end, v_uid, p_estado, nullif(left(btrim(coalesce(p_nota, '')), 500), ''), p_recordar, v_uid)
  returning * into s;
  return public._seguimiento_json(s);
end;
$$;

create function public.seguimiento_actualizar(p_id uuid, p_hecho boolean, p_recordar date) returns jsonb language plpgsql security definer set search_path = public as
$$
declare s public.cc_seguimientos;
begin
  select * into s from public.cc_seguimientos where id = p_id for update;
  if not found or not (s.seller_profile_id = auth.uid() or public.auth_role() = 'admin' or public._jefe_ventas()) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if coalesce(p_hecho, false) then
    update public.cc_seguimientos set hecho_at = now() where id = p_id returning * into s;
  elsif p_recordar is not null then   -- posponer
    if p_recordar < public.hoy_local() or p_recordar > public.hoy_local() + 365 then raise exception 'DATO_INVALIDO:fecha'; end if;
    update public.cc_seguimientos set recordar_el = p_recordar, avisado_el = null where id = p_id returning * into s;
  end if;
  return public._seguimiento_json(s);
end;
$$;

-- El seguimiento vigente de un cliente o conversación (para la franja del chat y la ficha).
create function public.seguimiento_de(p_customer uuid, p_conv uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_cust uuid := p_customer; s public.cc_seguimientos;
begin
  if v_cust is null and p_conv is not null then select customer_id into v_cust from public.cc_conversations where id = p_conv; end if;
  if not public._puede_seguimiento(v_cust, p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_seguimientos x
   where x.hecho_at is null and ((v_cust is not null and x.customer_id = v_cust) or (v_cust is null and x.conversation_id = p_conv))
   order by (x.seller_profile_id = auth.uid()) desc, x.recordar_el limit 1;
  return case when found then public._seguimiento_json(s) end;
end;
$$;

create function public.mis_seguimientos() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_todos boolean;
begin
  if v_uid is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_todos := public.auth_role() = 'admin' or public._jefe_ventas();
  return jsonb_build_object('hoy', public.hoy_local(), 'seguimientos', coalesce((
    select jsonb_agg(public._seguimiento_json(s) order by s.recordar_el, s.created_at)
      from public.cc_seguimientos s where s.hecho_at is null and (s.seller_profile_id = v_uid or v_todos)), '[]'::jsonb));
end;
$$;

-- Cron: el día que toca (desde las 9:00 de Culiacán) una alerta al vendedor; una por día.
create function public.cc_seguimientos_avisar() returns integer language plpgsql security definer set search_path = public as
$$
declare s public.cc_seguimientos; n int := 0; v_hora int := extract(hour from (now() at time zone 'America/Mazatlan'))::int;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not (public._cc_es_admin() or public._cc_es_service()) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_hora < 9 then return 0; end if;
  for s in select * from public.cc_seguimientos where hecho_at is null and recordar_el <= public.hoy_local() and avisado_el is distinct from public.hoy_local() for update skip locked loop
    perform public._cc_notificar('seguimiento', null, array[s.seller_profile_id], null,
      'Hoy toca retomar a ' || coalesce((public._seguimiento_json(s) ->> 'nombre'), 'un cliente') || coalesce(': ' || s.nota, ''),
      'seguimientos', 'seguimiento:' || s.id::text || ':' || public.hoy_local()::text);
    update public.cc_seguimientos set avisado_el = public.hoy_local() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public._puede_seguimiento(uuid, uuid), public._seguimiento_json(public.cc_seguimientos) from public, anon, authenticated;
revoke all on function public.seguimiento_guardar(uuid, uuid, text, text, date), public.seguimiento_actualizar(uuid, boolean, date), public.seguimiento_de(uuid, uuid), public.mis_seguimientos() from public, anon;
grant execute on function public.seguimiento_guardar(uuid, uuid, text, text, date), public.seguimiento_actualizar(uuid, boolean, date), public.seguimiento_de(uuid, uuid), public.mis_seguimientos() to authenticated;
revoke all on function public.cc_seguimientos_avisar() from public, anon, authenticated;
grant execute on function public.cc_seguimientos_avisar() to service_role;

do $cron$
declare r record;
begin
  for r in select jobid from cron.job where jobname = 'renovacell-seguimientos' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('renovacell-seguimientos'::text, '*/15 * * * *'::text, 'select public.cc_seguimientos_avisar();'::text);
end $cron$;

do $post$ begin
  if to_regprocedure('public.mis_seguimientos()') is null or (select count(*) from cron.job where jobname = 'renovacell-seguimientos' and active) <> 1 then
    raise exception 'BLOQUE-C: no quedó aplicada'; end if;
end $post$;
