-- ============================================================================
-- REPARTO POR TURNO + VERIFICACIÓN POR VENDEDORES + PROMOCIONES PARA ALMACÉN Y VENTAS (2 nov 2026). Dueño:
--   "quiero que chequees que realmente les están llegando 1 y 1 de prospectos a los vendedores" → era AL AZAR
--   (order by random(): Alejandra 3, Roberto 0 en 14 días). Ahora es por TURNO: le toca a quien hace más tiempo que no
--   recibe uno (empate: al azar), para prospectos, verificaciones y leads del sitio. Nunca una cuenta interna.
--   "que toda la verificación la hagan los vendedores" → la verificación por WhatsApp de un contacto sin vendedor ya no
--   va a Dirección: se le asigna por turno a un vendedor (queda como su prospecto, la IA sigue atendiendo) y a él le
--   llegan los avisos. Dirección solo si no hay ningún vendedor que reciba clientes nuevos.
--   "quiero que Alberto y ventas tengan acceso a las promociones" → crean, editan, pausan y borran promociones y
--   flyers. Enviar a los doctores: Dirección/Facturación a todos; un vendedor, solo a su cartera.
-- ============================================================================
create table if not exists public.cc_reparto_turnos (
  seller_profile_id uuid primary key references public.profiles(id) on delete cascade,
  ultimo_at timestamptz not null default now(),
  recibidos bigint not null default 0
);
alter table public.cc_reparto_turnos enable row level security;
revoke all on public.cc_reparto_turnos from public, anon, authenticated;

-- El siguiente en turno (y se le marca): quien hace más tiempo que no recibe un prospecto.
create or replace function public._cc_vendedor_turno(p_excluir uuid[] default '{}') returns uuid
  language plpgsql volatile security definer set search_path = public as
$$
declare s uuid;
begin
  select p.id into s from public.profiles p left join public.cc_reparto_turnos t on t.seller_profile_id = p.id
   where p.role_id = 'pos' and not coalesce(p.interna, false) and public._cc_vendedor_elegible(p.id, true) and not (p.id = any (coalesce(p_excluir, '{}')))
   order by t.ultimo_at asc nulls first, random() limit 1;
  if s is not null then
    insert into public.cc_reparto_turnos as t (seller_profile_id, ultimo_at, recibidos) values (s, clock_timestamp(), 1)
    on conflict (seller_profile_id) do update set ultimo_at = clock_timestamp(), recibidos = t.recibidos + 1;
  end if;
  return s;
end;
$$;

-- Los nombres de siempre (los usan el reparto de asesorías, la verificación y la Edge capture-lead) ahora van por turno.
create or replace function public._cc_vendedor_azar(p_excluir uuid[] default '{}') returns uuid
  language sql volatile security definer set search_path = public as
$$ select public._cc_vendedor_turno(p_excluir) $$;
create or replace function public._cc_reparto_elegir(p_conv uuid) returns uuid
  language sql volatile security definer set search_path = public as
$$ select public._cc_vendedor_turno(coalesce((select c.reparto_probados from public.cc_conversations c where c.id = p_conv), '{}')) $$;

-- El responsable comercial también es el vendedor al que se le asignó el prospecto (aunque la IA lo siga atendiendo).
create or replace function public._cc_responsable_comercial(p_conv uuid) returns uuid
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    case when c.modo in ('human_assigned', 'human_active') then c.seller_profile_id end,
    case when c.profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(c.profile_id), false) then public._cc_vendedor_de(c.profile_id) end,
    (select public._cc_vendedor_de(w.vinculo_profile_id) from public.cc_wa_contactos w
      where w.wa_id = (public._cc_wa_contacto_de(c.id)).wa_id and w.vinculo_profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(w.vinculo_profile_id), false)),
    case when c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then public._cc_vendedor_de_cliente(c.customer_id) end,
    case when public._cc_vendedor_elegible(c.seller_profile_id, false) then c.seller_profile_id end,
    case when public._cc_vendedor_elegible(c.ultimo_asesor_id, false) then c.ultimo_asesor_id end)
  from public.cc_conversations c where c.id = p_conv
$$;

-- Sin responsable: por TURNO a un vendedor (queda como su prospecto; no cambia el modo, la IA sigue). Dirección solo
-- si no hay ningún vendedor que reciba clientes nuevos.
create or replace function public._cc_avisar_responsable(p_conv uuid, p_kind text, p_texto text, p_llave text) returns text
  language plpgsql security definer set search_path = public as
$$
declare v_s uuid := public._cc_responsable_comercial(p_conv);
begin
  if v_s is null then
    v_s := public._cc_vendedor_turno('{}');
    if v_s is not null then
      update public.cc_conversations set seller_profile_id = v_s, updated_at = now() where id = p_conv and seller_profile_id is null;
    end if;
  end if;
  if v_s is not null then return public._cc_notificar(p_kind, p_conv, array[v_s], null, p_texto, 'asesorias', p_llave); end if;
  return public._cc_notificar(p_kind, p_conv, null, array['admin'], p_texto, 'av_atencion', p_llave);
end;
$$;

-- Promociones y flyers: también Almacén y Ventas.
create or replace function public._promo_puede_administrar() returns boolean
  language sql stable set search_path = public as
$$ select auth.uid() is not null and public.auth_role() in ('admin', 'billing', 'warehouse', 'pos') $$;
-- Enviar a los doctores: Dirección/Facturación a todos; un vendedor, solo a su propia cartera.
create or replace function public._promo_puede_difundir(p_vendedor uuid) returns boolean
  language sql stable set search_path = public as
$$ select coalesce(auth.uid() is not null and (public.auth_role() in ('admin', 'billing') or (public.auth_role() = 'pos' and p_vendedor = auth.uid())), false) $$;
do $d$
declare v text := pg_get_functiondef('public.promocion_difundir(uuid,text[],uuid)'::regprocedure);
begin
  if position('if not public._promo_puede_administrar() then raise exception ''NO_AUTORIZADO: solo Dirección o Facturación mandan promociones''' in v) = 0 then raise exception 'REPARTO_TURNO: promocion_difundir cambió; revisar antes de aplicar'; end if;
  execute replace(v, 'if not public._promo_puede_administrar() then raise exception ''NO_AUTORIZADO: solo Dirección o Facturación mandan promociones''', 'if not public._promo_puede_difundir(p_vendedor) then raise exception ''NO_AUTORIZADO: solo Dirección, Facturación o el vendedor a su propia cartera mandan promociones''');
end $d$;

do $g$ begin
  execute 'revoke all on function public._cc_vendedor_turno(uuid[]) from public, anon, authenticated';
  execute 'grant execute on function public._cc_vendedor_turno(uuid[]), public._cc_vendedor_azar(uuid[]) to service_role';
  execute 'grant execute on function public._promo_puede_administrar(), public._promo_puede_difundir(uuid) to authenticated';
end $g$;
