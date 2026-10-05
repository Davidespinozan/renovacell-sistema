-- ============================================================================
-- W6-A1 · ROLLBACK. Devuelve auth_role / has_cap / is_verified / profiles_guard a su texto
-- anterior, retira los comandos y la columna.
--
-- ABORTA si hay alguna cuenta suspendida: bajar W6-A1 la reactivaría en silencio,
-- y eso es exactamente lo que Dirección decidió que no pasara. Primero reactívalas
-- (o deja W6-A1 arriba).
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
do $$
declare v_n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'active') then
    raise notice 'W6-A1 no está aplicado: nada que bajar.';
    return;
  end if;
  select count(*) into v_n from public.profiles where not active;
  if v_n > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % cuenta(s) suspendida(s). Bajar W6-A1 las reactivaría.', v_n;
  end if;
end $$;

-- profiles_guard vuelve a su texto anterior (el trigger se conserva: ya existía).
create or replace function public.profiles_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     or public.auth_role() = 'admin' then
    return new;
  end if;
  if new.role_id is distinct from old.role_id
     or new.verified is distinct from old.verified
     or new.price_list_id is distinct from old.price_list_id
     or (coalesce(new.meta -> 'capabilities', 'null'::jsonb) is distinct from coalesce(old.meta -> 'capabilities', 'null'::jsonb)) then
    raise exception 'No autorizado: no puedes modificar role_id, verified, price_list_id ni capacidades';
  end if;
  return new;
end; $$;
drop function if exists public.reactivar_staff(uuid);
drop function if exists public.suspender_staff(uuid, text, boolean);
drop function if exists public._staff_objetivo(uuid);

create or replace function public.auth_role() returns text
  language sql stable security definer set search_path = public as
$$
  select coalesce((select role_id from public.profiles where id = auth.uid()), '');
$$;
create or replace function public.has_cap(cap text) returns boolean
  language sql stable security definer set search_path = public as
$$
  SELECT COALESCE(
    (SELECT (meta -> 'capabilities') ? cap FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;
create or replace function public.is_verified() returns boolean
  language sql stable security definer set search_path = public as
$$
  SELECT COALESCE((SELECT verified FROM public.profiles WHERE id = auth.uid()), false);
$$;
create or replace function public.log_audit(p_action text, p_resource text, p_detail text, p_actor_name text)
  returns void language plpgsql security definer set search_path = public as
$$
DECLARE real_name text;
BEGIN
  SELECT COALESCE(meta ->> 'name', full_name, email) INTO real_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs(actor, action, resource_type, resource_id, payload)
  VALUES (auth.uid(), p_action, 'app', p_resource,
    jsonb_build_object('actor_name', COALESCE(real_name, p_actor_name), 'area', p_actor_name, 'detail', p_detail));
END; $$;
drop function if exists public._cuenta_suspendida();
alter table public.profiles drop column if exists active;
