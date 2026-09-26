-- ============================================================================
-- CUSTOMER 360 · FASE 1 — Convergencia de identidad FUTURA (no dedupe histórico).
--   • Resolver central server-side: resolve_customer_identity (una sola regla omnicanal).
--   • prospects.customer_id (FK aditiva) + backfill DETERMINISTA (solo inequívoco).
--   • orders.customer_id backfill determinista (doctor_id → único customer por profile_id).
--   • upsert_customer_contact: sync de contacto acotado (merge conservador, sin pisar dato bueno).
--   • admin_approve_doctor: preserva seller_name/organization/notas al crear customer.
-- NO impone UNIQUE(email/phone). NO deduplica. NO toca fiscal (cerrado). Aditiva.
-- ============================================================================

-- ── Normalización compartida (privada) ─────────────────────────────────────────────────────
create or replace function public._norm_email(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(lower(btrim(coalesce(p,''))), '')
$$;

-- Teléfono: solo dígitos; se toman los últimos 10 (normaliza +52 / 52 / 521). < 10 dígitos = no
-- confiable (NULL). Consistente con el resolver del front (identity.ts). NO asume unicidad.
create or replace function public._norm_phone(p text) returns text
language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(p,''),'[^0-9]','','g')) >= 10
              then right(regexp_replace(coalesce(p,''),'[^0-9]','','g'), 10)
              else null end
$$;

-- ── RESOLVER CENTRAL ────────────────────────────────────────────────────────────────────────
-- Devuelve { status: EXACT|MATCH|NOT_FOUND|AMBIGUOUS, customer_id, signals[] }. Sin PII.
-- Precedencia: profile_id → (source,external_id) → email norm → teléfono norm. Nombre = NO decide.
-- Señales fuertes que apuntan a customers distintos, o una señal con múltiples customers → AMBIGUOUS.
create or replace function public.resolve_customer_identity(
  p_profile_id uuid   default null,
  p_external_id text  default null,
  p_source text       default null,
  p_email text        default null,
  p_phone text        default null,
  p_name text         default null   -- auxiliar; NUNCA decide match por sí solo
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_role text := public.auth_role();
  v_is_service boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role';
  v_email text := public._norm_email(p_email);
  v_phone text := public._norm_phone(p_phone);
  v_cid uuid;
  v_email_ids uuid[];
  v_phone_ids uuid[];
  n_email int; n_phone int;
begin
  -- Autorización: solo staff que gestiona identidad (o contexto service_role de los Edge).
  -- El doctor NO puede llamar esto → evita enumeración de customers.
  if not (v_is_service or v_role = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- A) profile_id ya ligado → EXACT.
  if p_profile_id is not null then
    select id into v_cid from public.customers where profile_id = p_profile_id limit 1;
    if v_cid is not null then
      return jsonb_build_object('status','EXACT','customer_id',v_cid,'signals',jsonb_build_array('profile_id'));
    end if;
  end if;

  -- B) (source, external_id) → EXACT (único por source).
  if p_external_id is not null and coalesce(btrim(p_source),'') <> '' then
    select id into v_cid from public.customers where source = p_source and external_id = p_external_id limit 1;
    if v_cid is not null then
      return jsonb_build_object('status','EXACT','customer_id',v_cid,'signals',jsonb_build_array('external_id'));
    end if;
  end if;

  -- C/D) email y teléfono normalizados (soportando duplicados históricos: >1 → AMBIGUOUS).
  if v_email is not null then
    select array_agg(id) into v_email_ids from public.customers where active and public._norm_email(email) = v_email;
  end if;
  if v_phone is not null then
    select array_agg(id) into v_phone_ids from public.customers where active and public._norm_phone(phone) = v_phone;
  end if;
  n_email := coalesce(array_length(v_email_ids,1),0);
  n_phone := coalesce(array_length(v_phone_ids,1),0);

  if n_email > 1 or n_phone > 1 then
    return jsonb_build_object('status','AMBIGUOUS','customer_id',null,'signals',jsonb_build_array('multiple'));
  end if;
  if n_email = 1 and n_phone = 1 then
    if v_email_ids[1] = v_phone_ids[1] then
      return jsonb_build_object('status','MATCH','customer_id',v_email_ids[1],'signals',jsonb_build_array('email','phone'));
    else
      return jsonb_build_object('status','AMBIGUOUS','customer_id',null,'signals',jsonb_build_array('email_phone_conflict'));
    end if;
  end if;
  if n_email = 1 then return jsonb_build_object('status','MATCH','customer_id',v_email_ids[1],'signals',jsonb_build_array('email')); end if;
  if n_phone = 1 then return jsonb_build_object('status','MATCH','customer_id',v_phone_ids[1],'signals',jsonb_build_array('phone')); end if;

  return jsonb_build_object('status','NOT_FOUND','customer_id',null,'signals',jsonb_build_array());
end;
$fn$;

-- ── SYNC DE CONTACTO ACOTADO (Mi Perfil del doctor / staff) ──────────────────────────────────
-- Merge CONSERVADOR: un valor nuevo vacío/NULL NUNCA pisa un dato bueno; un valor nuevo válido
-- actualiza (el dueño tiene autoridad sobre su propio contacto). Solo campos de contacto; jamás
-- toca profile_id/active/source/external_id ni meta.fiscal. seller_name solo lo cambia staff.
create or replace function public.upsert_customer_contact(p_customer_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_role text := public.auth_role();
  v_meta jsonb;
begin
  if p_customer_id is null then raise exception 'CLIENTE_REQUERIDO'; end if;
  if v_role = any (array['admin','billing','pos']) then
    null;
  elsif exists (select 1 from public.customers where id = p_customer_id and profile_id = auth.uid()) then
    null;
  else
    raise exception 'NO_AUTORIZADO';
  end if;

  select meta into v_meta from public.customers where id = p_customer_id for update;
  if not found then raise exception 'CLIENTE_INEXISTENTE'; end if;

  update public.customers set
    full_name  = coalesce(nullif(btrim(p_patch->>'full_name'),''), full_name),
    email      = coalesce(nullif(btrim(p_patch->>'email'),''), email),
    phone      = coalesce(nullif(btrim(p_patch->>'phone'),''), phone),
    city       = coalesce(nullif(btrim(p_patch->>'city'),''), city),
    -- seller_name solo si lo manda staff (el doctor no reasigna su vendedor)
    seller_name = case when v_role = any (array['admin','billing','pos'])
                       then coalesce(nullif(btrim(p_patch->>'seller_name'),''), seller_name)
                       else seller_name end,
    meta = coalesce(meta,'{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'organization', coalesce(nullif(btrim(p_patch->>'organization'),''), meta->>'organization'),
                'notes',        coalesce(nullif(btrim(p_patch->>'notes'),''), meta->>'notes')))
    , updated_at = now()
  where id = p_customer_id;

  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end;
$fn$;

-- ── admin_approve_doctor v2 — preserva contexto comercial al CREAR customer ───────────────────
create or replace function public.admin_approve_doctor(
  p_profile uuid,
  p_customer_id uuid default null,
  p_new_customer jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_customer uuid;
  v_existing uuid;
begin
  if not (coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
          or public.auth_role() = 'admin') then
    raise exception 'No autorizado: solo Administración puede aprobar doctores.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and role_id = 'doctor') then
    raise exception 'Perfil de doctor no encontrado.';
  end if;

  if p_customer_id is not null then
    select profile_id into v_existing from public.customers where id = p_customer_id;
    if not found then raise exception 'Cliente no encontrado.'; end if;
    if v_existing is not null and v_existing <> p_profile then
      raise exception 'Ese cliente ya está vinculado a otro portal.';
    end if;
    update public.customers set profile_id = p_profile, updated_at = now() where id = p_customer_id;
    v_customer := p_customer_id;
  elsif p_new_customer is not null then
    select id into v_customer from public.customers where profile_id = p_profile limit 1;
    if v_customer is null then
      -- Preserva TODO el contexto comercial disponible: seller_name (columna) y
      -- organization/notes (meta). NULL/'' nunca fabrica valores.
      insert into public.customers (full_name, email, phone, city, source, seller_name, profile_id, meta)
      values (
        coalesce(nullif(p_new_customer->>'full_name',''), (select full_name from public.profiles where id = p_profile), 'Doctor'),
        nullif(p_new_customer->>'email',''),
        nullif(p_new_customer->>'phone',''),
        nullif(p_new_customer->>'city',''),
        coalesce(nullif(p_new_customer->>'source',''), 'portal'),
        nullif(p_new_customer->>'seller_name',''),
        p_profile,
        coalesce(p_new_customer->'meta', '{}'::jsonb)
      )
      returning id into v_customer;
    end if;
  else
    raise exception 'Debes vincular un cliente existente o crear uno nuevo.';
  end if;

  update public.profiles
     set verified = true,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
           'verification', jsonb_build_object('status', 'verified', 'reviewed_at', now(), 'reviewed_by', auth.uid())
         )
   where id = p_profile;

  -- Cierra el lazo prospect ↔ customer para conversiones (determinista: convertedDoctorId = ESTE profile).
  update public.prospects
     set customer_id = v_customer
   where customer_id is null
     and meta->>'convertedDoctorId' = p_profile::text;

  return jsonb_build_object('ok', true, 'customer_id', v_customer);
end;
$fn$;

-- ── prospects.customer_id (FK aditiva) + backfill DETERMINISTA ────────────────────────────────
alter table public.prospects add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists idx_prospects_customer on public.prospects(customer_id) where customer_id is not null;

-- Backfill inequívoco: prospect convertido → profile (meta.convertedDoctorId) → customer (profile_id
-- es ÚNICO). Cualquier duda → queda NULL (no se fuerza).
update public.prospects pr
   set customer_id = c.id
  from public.customers c
 where pr.customer_id is null
   and pr.meta->>'convertedDoctorId' ~ '^[0-9a-fA-F-]{36}$'
   and c.profile_id = (pr.meta->>'convertedDoctorId')::uuid;

-- ── orders.customer_id backfill DETERMINISTA (doctor_id → único customer por profile_id) ───────
-- El orders_guard bloquea cambios financieros salvo contexto confiable; este backfill solo enlaza
-- la identidad comercial (no toca dinero/estado), así que se marca trusted para pasar el trigger.
-- set_config(...,false) = nivel sesión: válido con o sin transacción (evita warning de SET LOCAL).
select set_config('app.trusted','on', false);
update public.orders o
   set customer_id = c.id
  from public.customers c
 where o.customer_id is null
   and o.doctor_id is not null
   and c.profile_id = o.doctor_id;
select set_config('app.trusted','off', false);

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public._norm_email(text) from public, anon, authenticated;
revoke all on function public._norm_phone(text) from public, anon, authenticated;
revoke all on function public.resolve_customer_identity(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.upsert_customer_contact(uuid, jsonb) from public, anon;
grant execute on function public.resolve_customer_identity(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.upsert_customer_contact(uuid, jsonb) to authenticated;
