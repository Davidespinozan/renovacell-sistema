-- ============================================================================
-- FASE 1 · Aprobación de doctor ATÓMICA (verified + customer) — admin-only.
-- ADITIVA y NO destructiva: solo crea la función `admin_approve_doctor`. No altera
-- tablas, RLS, ni datos. NO debilita is_verified()/profiles_guard (los respeta).
-- NO auto-vincula por email: el customer lo resuelve el humano en el cockpit y aquí
-- solo se vincula el id elegido o se crea uno nuevo. Idempotente.
--   ⚠️ NO APLICAR sin confirmación explícita del cliente (misma política del resto).
-- ============================================================================
create or replace function public.admin_approve_doctor(
  p_profile uuid,
  p_customer_id uuid default null,
  p_new_customer jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_customer uuid;
  v_existing uuid;
begin
  -- 1) Autorización: solo admin (o service_role). Espeja profiles_guard.
  if not (coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
          or public.auth_role() = 'admin') then
    raise exception 'No autorizado: solo Administración puede aprobar doctores.';
  end if;

  -- 2) El perfil debe existir y ser doctor.
  if not exists (select 1 from public.profiles where id = p_profile and role_id = 'doctor') then
    raise exception 'Perfil de doctor no encontrado.';
  end if;

  -- 3) Resolver identidad comercial (customer). NUNCA merge automático por email.
  if p_customer_id is not null then
    select profile_id into v_existing from public.customers where id = p_customer_id;
    if not found then raise exception 'Cliente no encontrado.'; end if;
    -- Bloquear si el customer ya pertenece a OTRO portal (respeta uq_customers_profile).
    if v_existing is not null and v_existing <> p_profile then
      raise exception 'Ese cliente ya está vinculado a otro portal.';
    end if;
    update public.customers set profile_id = p_profile, updated_at = now() where id = p_customer_id;
    v_customer := p_customer_id;
  elsif p_new_customer is not null then
    -- Idempotencia: si el profile YA tiene customer, reutilízalo (no dupliques).
    select id into v_customer from public.customers where profile_id = p_profile limit 1;
    if v_customer is null then
      insert into public.customers (full_name, email, phone, city, source, profile_id, meta)
      values (
        coalesce(nullif(p_new_customer->>'full_name',''), (select full_name from public.profiles where id = p_profile), 'Doctor'),
        nullif(p_new_customer->>'email',''),
        nullif(p_new_customer->>'phone',''),
        nullif(p_new_customer->>'city',''),
        coalesce(nullif(p_new_customer->>'source',''), 'portal'),
        p_profile,
        coalesce(p_new_customer->'meta', '{}'::jsonb)
      )
      returning id into v_customer;
    end if;
  else
    raise exception 'Debes vincular un cliente existente o crear uno nuevo.';
  end if;

  -- 4) Marcar verificado + estado legible (merge NO destructivo de meta).
  update public.profiles
     set verified = true,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
           'verification', jsonb_build_object('status', 'verified', 'reviewed_at', now(), 'reviewed_by', auth.uid())
         )
   where id = p_profile;

  return jsonb_build_object('ok', true, 'customer_id', v_customer);
end;
$fn$;

revoke all on function public.admin_approve_doctor(uuid, uuid, jsonb) from public, anon;
grant execute on function public.admin_approve_doctor(uuid, uuid, jsonb) to authenticated;
