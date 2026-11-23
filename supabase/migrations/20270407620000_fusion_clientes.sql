-- FUSIÓN DE CLIENTES REPETIDOS (23 nov 2026, dueño: «haz lo que consideres más profesional»). Al 23 nov había 100 grupos
-- de fichas activas con el mismo teléfono (210 fichas) y 58 con el mismo correo (119), anteriores a la identidad única
-- (0761). No se juntan en automático (una clínica puede compartir teléfono): Dirección revisa cada grupo y decide.
--   · clientes_duplicados(): grupos sospechosos (mismo teléfono, correo o cédula), sin los que ya se marcaron distintos.
--   · clientes_fusionar(queda, [se_van], motivo): pasa a la ficha que se queda lo operativo —conversaciones, teléfonos,
--     domicilios, facturación, cartera, oportunidades, cotizaciones, seguimientos, etiquetas, invitaciones, difusiones,
--     enlaces— resolviendo cada regla de «solo uno»; las notas se COPIAN; lo que le falte a la que se queda se toma de la
--     otra; la otra queda ARCHIVADA (inactiva, «fusionada en …»), nunca borrada.
--   · Lo que es evidencia NO se mueve (reglas del sistema): los PEDIDOS (identidad comercial inmutable, CX-0b), la
--     bitácora de actividad y las notas (solo se agregan), los mensajes enviados (comm_outbox) y las custodias. Por eso
--     una ficha CON PEDIDOS solo puede ser la que se queda (al 23 nov: 134 de 136 grupos sin pedidos; 2 con pedidos en una
--     sola ficha; ninguno con dos cuentas del portal). Dos cuentas del portal no se fusionan.
--   · clientes_marcar_distintos([ids]): «son distintos», no se vuelven a sugerir juntos.
-- Solo Dirección. Todo queda en la bitácora clientes_fusiones y en la actividad de ambas fichas.

create table if not exists public.clientes_fusiones (
  id bigint generated always as identity primary key,
  queda uuid not null references public.customers(id),
  se_va uuid not null references public.customers(id),
  motivo text,
  resumen jsonb not null default '{}'::jsonb,
  por uuid,
  at timestamptz not null default now()
);
create table if not exists public.clientes_no_duplicados (
  a uuid not null references public.customers(id) on delete cascade,
  b uuid not null references public.customers(id) on delete cascade,
  por uuid, at timestamptz not null default now(),
  primary key (a, b), check (a < b)
);
alter table public.clientes_fusiones enable row level security;
alter table public.clientes_no_duplicados enable row level security;
revoke all on public.clientes_fusiones, public.clientes_no_duplicados from anon, authenticated;

-- ── Sugerencias ───────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.clientes_duplicados(p_limite integer default 60)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    with k as (
      select c.id, 'telefono' as tipo, public._c360_tel_norm(c.phone) as v from public.customers c where c.active and length(public._c360_tel_norm(c.phone)) = 10
      union select ph.customer_id, 'telefono', ph.numero_norm from public.customer_phones ph join public.customers c on c.id = ph.customer_id and c.active where ph.activo and length(ph.numero_norm) = 10
      union select c.id, 'correo', lower(btrim(c.email)) from public.customers c where c.active and nullif(btrim(coalesce(c.email, '')), '') is not null
      union select c.id, 'cedula', regexp_replace(c.meta ->> 'cedula', '[^0-9]', '', 'g') from public.customers c where c.active and length(regexp_replace(coalesce(c.meta ->> 'cedula', ''), '[^0-9]', '', 'g')) >= 5
    ),
    g as (select tipo, v, array_agg(distinct id order by id) as ids from k group by tipo, v having count(distinct id) > 1),
    g2 as (select ids, array_agg(distinct tipo order by tipo) as por from g group by ids),
    g3 as (select * from g2 where exists (select 1 from unnest(g2.ids) as x(ida), unnest(g2.ids) as y(idb) where x.ida < y.idb
                                            and not exists (select 1 from public.clientes_no_duplicados nd where nd.a = x.ida and nd.b = y.idb))),
    det as (
      select g3.ids, g3.por, jsonb_agg(jsonb_build_object(
          'id', c.id, 'nombre', c.full_name, 'correo', c.email,
          'telefono', coalesce((select ph.numero from public.customer_phones ph where ph.customer_id = c.id and ph.activo and ph.es_principal limit 1), c.phone),
          'ciudad', c.city, 'origen', c.source, 'portal', c.profile_id is not null, 'cedula', nullif(c.meta ->> 'cedula', '') is not null,
          'vendedor', public._cc_nombre_personal(public._cc_vendedor_de_cliente(c.id)),
          'pedidos', (select count(*) from public.orders o where o.customer_id = c.id and o.status <> 'cancelled'),
          'total', (select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = c.id and o.status <> 'cancelled'),
          'creado', c.created_at)
          order by (c.profile_id is not null) desc, (select count(*) from public.orders o where o.customer_id = c.id) desc, c.created_at) as fichas,
        sum((select count(*) from public.orders o where o.customer_id = c.id)) as peso
      from g3 join public.customers c on c.id = any (g3.ids) group by g3.ids, g3.por)
    select jsonb_agg(jsonb_build_object('ids', to_jsonb(ids), 'por', to_jsonb(por), 'fichas', fichas) order by peso desc, cardinality(ids))
    from (select * from det order by peso desc limit greatest(1, least(coalesce(p_limite, 60), 300))) z), '[]'::jsonb);
end;
$f$;

-- ── Fusión de una ficha en otra ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public._cliente_fusionar_uno(p_queda uuid, p_se_va uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare q public.customers; v public.customers; vq uuid; vv uuid; r jsonb := '{}'::jsonb; n int; t text; v_prof uuid;
begin
  if p_queda is null or p_se_va is null or p_queda = p_se_va then raise exception 'FUSION_INVALIDA: elige dos fichas distintas' using errcode = 'check_violation'; end if;
  select * into q from public.customers where id = p_queda for update;
  if not found or not q.active then raise exception 'FUSION_INVALIDA: la ficha que se queda no existe o está archivada' using errcode = 'check_violation'; end if;
  select * into v from public.customers where id = p_se_va for update;
  if not found or not v.active then raise exception 'FUSION_INVALIDA: la ficha a fusionar no existe o ya está archivada' using errcode = 'check_violation'; end if;
  if q.profile_id is not null and v.profile_id is not null then
    raise exception 'DOS_CUENTAS: las dos fichas tienen cuenta del portal (son dos accesos distintos); no se pueden fusionar' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.orders o where o.customer_id = p_se_va) then
    raise exception 'TIENE_PEDIDOS: «%» tiene pedidos (no se mueven de ficha): elígela como la que se queda', v.full_name using errcode = 'check_violation'; end if;
  if exists (select 1 from public.custodies x where x.status = 'abierta' and x.holder_customer_id = p_se_va) then
    raise exception 'CUSTODIA_ABIERTA: «%» tiene una custodia abierta; ciérrala antes de fusionar', v.full_name using errcode = 'check_violation'; end if;
  vv := public._cc_vendedor_de_cliente(p_se_va);

  -- 1. La cuenta del portal (si solo la tiene la que se va) pasa a la que se queda; su vendedora viaja con la cuenta.
  if v.profile_id is not null then
    v_prof := v.profile_id;
    update public.customers set profile_id = null, updated_at = now() where id = p_se_va;
    update public.customers set profile_id = v_prof, updated_at = now() where id = p_queda;
    r := r || jsonb_build_object('cuenta', true);
  end if;

  -- 2. Lo que tiene regla de «solo uno»
  update public.customer_phones set activo = false, es_principal = false, updated_at = now()   -- principal ⇒ activo (ck_cph_principal_activo)
   where customer_id = p_se_va and activo and numero_norm in (select numero_norm from public.customer_phones where customer_id = p_queda and activo);
  if exists (select 1 from public.customer_phones where customer_id = p_queda and activo and es_principal) then
    update public.customer_phones set es_principal = false, updated_at = now() where customer_id = p_se_va and es_principal;
  end if;
  update public.customer_phones set customer_id = p_queda, updated_at = now() where customer_id = p_se_va;
  get diagnostics n = row_count; r := r || jsonb_build_object('telefonos', n);
  if exists (select 1 from public.doctor_locations where customer_id = p_queda and is_default and active) then
    update public.doctor_locations set is_default = false where customer_id = p_se_va and is_default;
  end if;
  update public.doctor_locations set customer_id = p_queda where customer_id = p_se_va;
  get diagnostics n = row_count; r := r || jsonb_build_object('domicilios', n);
  if exists (select 1 from public.customer_fiscal_profiles where customer_id = p_queda and es_predeterminado and activo) then
    update public.customer_fiscal_profiles set es_predeterminado = false where customer_id = p_se_va and es_predeterminado;
  end if;
  update public.customer_fiscal_profiles set customer_id = p_queda where customer_id = p_se_va;
  get diagnostics n = row_count; r := r || jsonb_build_object('fiscales', n);
  if exists (select 1 from public.cliente_invitaciones where customer_id = p_queda and usada_at is null and revocada_at is null) then
    update public.cliente_invitaciones set revocada_at = now() where customer_id = p_se_va and usada_at is null and revocada_at is null;
  end if;
  update public.cliente_invitaciones set customer_id = p_queda where customer_id = p_se_va;
  if exists (select 1 from public.cc_enlaces where customer_id = p_queda and tipo = 'referido' and activo) then
    update public.cc_enlaces set activo = false where customer_id = p_se_va and tipo = 'referido' and activo;
  end if;
  update public.cc_enlaces set customer_id = p_queda where customer_id = p_se_va;
  delete from public.cc_difusion_envios d where d.customer_id = p_se_va
     and exists (select 1 from public.cc_difusion_envios x where x.customer_id = p_queda and x.difusion_id = d.difusion_id and x.canal = d.canal);
  update public.cc_difusion_envios set customer_id = p_queda where customer_id = p_se_va;
  insert into public.cc_etiqueta_clientes (etiqueta_id, customer_id, added_at)
    select etiqueta_id, p_queda, added_at from public.cc_etiqueta_clientes where customer_id = p_se_va on conflict do nothing;
  delete from public.cc_etiqueta_clientes where customer_id = p_se_va;
  delete from public.invitacion_envios e where e.customer_id = p_se_va and exists (select 1 from public.invitacion_envios x where x.customer_id = p_queda and x.campana_id = e.campana_id);
  update public.invitacion_envios set customer_id = p_queda where customer_id = p_se_va;
  delete from public.c4a_exclusiones e where e.customer_id = p_se_va and exists (select 1 from public.c4a_exclusiones x where x.customer_id = p_queda);
  update public.c4a_exclusiones set customer_id = p_queda where customer_id = p_se_va;

  -- 3. Lo que solo se re-apunta (historia y operación)
  update public.cc_conversations set customer_id = p_queda where customer_id = p_se_va;
  get diagnostics n = row_count; r := r || jsonb_build_object('conversaciones', n);
  update public.cotizaciones set customer_id = p_queda where customer_id = p_se_va;
  update public.crm_oportunidades set customer_id = p_queda where customer_id = p_se_va;
  insert into public.customer_notes (customer_id, texto, autor_profile_id, autor_rol, created_at)   -- notas: solo se agregan → se copian
    select p_queda, left('(de ficha fusionada) ' || texto, 2000), autor_profile_id, autor_rol, created_at from public.customer_notes where customer_id = p_se_va;
  get diagnostics n = row_count; r := r || jsonb_build_object('notas', n);
  update public.cc_seguimientos set customer_id = p_queda where customer_id = p_se_va;
  update public.cc_solicitudes_alta set customer_id = p_queda where customer_id = p_se_va;
  update public.prospeccion_llamadas set customer_id = p_queda where customer_id = p_se_va;
  update public.prospects set customer_id = p_queda where customer_id = p_se_va;
  update public.cc_wa_avisos set customer_id = p_queda where customer_id = p_se_va;
  update public.cc_cartera_eventos set customer_id = p_queda where customer_id = p_se_va;
  update public.cc_prerregistros set posible_customer_id = p_queda where posible_customer_id = p_se_va;
  update public.cc_visitors set referido_por = p_queda where referido_por = p_se_va;
  update public.cc_cartera_clientes_historial set customer_id = p_queda where customer_id = p_se_va;

  -- 4. Lo que le falta a la que se queda, de la otra (nunca pisa)
  update public.customers c set
    email = coalesce(c.email, v.email),
    city = coalesce(c.city, v.city),
    tipo_cliente = coalesce(c.tipo_cliente, v.tipo_cliente),
    especialidad = coalesce(c.especialidad, v.especialidad),
    especialidad_otra = case when c.especialidad is null then v.especialidad_otra else c.especialidad_otra end,
    seller_name = coalesce(c.seller_name, v.seller_name),
    meta = coalesce(c.meta, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('cedula', case when nullif(c.meta ->> 'cedula', '') is null then nullif(v.meta ->> 'cedula', '') end)),
    updated_at = now()
  where c.id = p_queda;
  if q.phone is null and v.phone is not null then update public.customers set phone = v.phone where id = p_queda; end if;

  -- 5. Cartera: si la que se queda no tiene vendedora y la otra sí, se queda con esa
  vq := public._cc_vendedor_de_cliente(p_queda);
  if vq is null and vv is not null then
    select profile_id into v_prof from public.customers where id = p_queda;
    if v_prof is not null then
      insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (v_prof, vv, now(), auth.uid(), 'Fusión de fichas repetidas') on conflict do nothing;
      insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (v_prof, null, vv, auth.uid(), 'Fusión de fichas repetidas');
    else
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_queda, vv, now(), auth.uid(), 'Fusión de fichas repetidas') on conflict do nothing;
      insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_queda, null, vv, auth.uid(), 'Fusión de fichas repetidas');
    end if;
    r := r || jsonb_build_object('vendedora_heredada', true);
  end if;
  if exists (select 1 from public.cc_cartera_clientes where customer_id = p_se_va) then
    delete from public.cc_cartera_clientes where customer_id = p_se_va;
    insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_se_va, vv, null, auth.uid(), 'Ficha fusionada en otra');
  end if;

  -- 6. La que se va queda archivada (nunca se borra) y todo queda escrito
  update public.customers set active = false, updated_at = now(),
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('fusionado_en', p_queda, 'fusionado_at', now(), 'fusionado_por', auth.uid())
   where id = p_se_va;
  perform public._c360_evento(p_queda, 'contacto_actualizado', jsonb_build_object('origen', 'fusion', 'de', p_se_va, 'campos', r), 'direccion');
  perform public._c360_evento(p_se_va, 'cliente_baja', jsonb_build_object('motivo', 'fusionada', 'en', p_queda), 'direccion');
  insert into public.clientes_fusiones (queda, se_va, motivo, resumen, por) values (p_queda, p_se_va, left(p_motivo, 300), r, auth.uid());
  return r;
end;
$f$;

create or replace function public.clientes_fusionar(p_queda uuid, p_se_van uuid[], p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare x uuid; out jsonb := '[]'::jsonb;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección fusiona fichas' using errcode = 'insufficient_privilege'; end if;
  if coalesce(cardinality(p_se_van), 0) = 0 or cardinality(p_se_van) > 20 then raise exception 'FUSION_INVALIDA: elige de 1 a 20 fichas a fusionar' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtext('fusion_clientes'));
  foreach x in array p_se_van loop
    out := out || jsonb_build_object('se_va', x, 'resumen', public._cliente_fusionar_uno(p_queda, x, p_motivo));
  end loop;
  return jsonb_build_object('queda', p_queda, 'fusionadas', out);
end;
$f$;

create or replace function public.clientes_marcar_distintos(p_ids uuid[])
returns integer language plpgsql security definer set search_path to 'public' as $f$
declare n integer;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if coalesce(cardinality(p_ids), 0) < 2 then raise exception 'FUSION_INVALIDA: marca al menos dos fichas' using errcode = 'check_violation'; end if;
  insert into public.clientes_no_duplicados (a, b, por)
    select x.ida, y.idb, auth.uid() from unnest(p_ids) as x(ida), unnest(p_ids) as y(idb) where x.ida < y.idb on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$f$;

revoke all on function public.clientes_duplicados(integer), public._cliente_fusionar_uno(uuid, uuid, text),
  public.clientes_fusionar(uuid, uuid[], text), public.clientes_marcar_distintos(uuid[]) from public, anon, authenticated;
grant execute on function public.clientes_duplicados(integer), public.clientes_fusionar(uuid, uuid[], text), public.clientes_marcar_distintos(uuid[]) to authenticated;
