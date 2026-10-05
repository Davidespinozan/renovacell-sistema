-- ============================================================================
-- W6-A1 · SUSPENSIÓN DE PERSONAL CON AUTORIDAD EN EL SERVIDOR
--
-- Antes, "suspender" a un empleado solo cambiaba `profiles.meta.active`, que únicamente
-- leía el inicio de sesión de la demo. Con una sesión viva (o iniciando una nueva), un
-- suspendido seguía leyendo y escribiendo todo lo que su rol permitía: `auth_role()`
-- —de la que dependen 93 políticas RLS y ~80 funciones— nunca miró ese dato.
--
-- Qué cambia
--   · `profiles.active` es ahora una COLUMNA (no una llave de JSON) y es autoridad.
--   · `auth_role()` FALLA CERRADO: para una cuenta suspendida no devuelve '' en
--     silencio, LANZA `CUENTA_SUSPENDIDA`. Así cada política y cada comando que la
--     consulta —sin tocarlos— niega al suspendido desde ese instante, y el cliente
--     recibe un motivo legible en vez de listas vacías.
--   · `has_cap()` e `is_verified()` también fallan cerrado (no son atajos).
--   · `active` y `role_id` solo cambian por comando: `suspender_staff` /
--     `reactivar_staff` (Dirección, nunca a sí misma, con motivo, auditado) y la
--     administración de personal del servidor (service_role). Un UPDATE directo
--     a esas columnas se rechaza.
--   · La "baja" deja de borrar la cuenta: es una suspensión marcada como baja
--     (`meta.baja`, informativo). La identidad histórica (actor, recorded_by,
--     created_by, driver_id…) se conserva.
--
-- Qué NO cambia
--   · Doctores: siguen gobernados por `verified`. Los comandos de este archivo
--     rechazan a un doctor como objetivo (`SOLO_STAFF`).
--   · service_role, cron y funciones internas: no pasan por `profiles` (auth.uid()
--     es NULL) → `auth_role()` sigue devolviendo '' para ellos, como hoy.
--   · Ningún comando, política ni tabla de W1–W5 se edita.
--
-- Rollback: supabase/rollback/w6a/99_down.sql (aborta si hay suspendidos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columna de autoridad + traslado del dato que vivía en el JSON
-- ---------------------------------------------------------------------------
alter table public.profiles add column active boolean not null default true;

-- Lo único que existía era `meta.active = false` escrito por el panel de Equipo. Se
-- traslada tal cual (hoy: 0 filas en producción) y solo para personal: un doctor
-- jamás queda inactivo por esta vía.
update public.profiles
   set active = false
 where role_id is distinct from 'doctor'
   and (meta ->> 'active') = 'false';

comment on column public.profiles.active is
  'W6-A1 · autoridad de acceso del PERSONAL. false ⇒ auth_role() lanza CUENTA_SUSPENDIDA. Solo cambia por suspender_staff / reactivar_staff.';

-- ---------------------------------------------------------------------------
-- 2) Fallo cerrado
-- ---------------------------------------------------------------------------
-- Lanza siempre. Vive aparte para que `auth_role()` siga siendo una función SQL
-- simple (inlinable en las políticas) y solo la llame cuando toca.
create function public._cuenta_suspendida() returns text
  language plpgsql stable set search_path = public as
$$
begin
  raise exception 'CUENTA_SUSPENDIDA: tu acceso fue suspendido por Dirección.'
    using errcode = 'insufficient_privilege';
end;
$$;

create or replace function public.auth_role() returns text
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select case when p.active then p.role_id else public._cuenta_suspendida() end
       from public.profiles p where p.id = auth.uid()),
    '');
$$;

create or replace function public.has_cap(cap text) returns boolean
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    (select p.active and ((p.meta -> 'capabilities') ? cap) from public.profiles p where p.id = auth.uid()),
    false);
$$;

create or replace function public.is_verified() returns boolean
  language sql stable security definer set search_path = public as
$$
  select coalesce((select p.active and p.verified from public.profiles p where p.id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- 3) `active` y `role_id` solo por comando
--    `profiles_guard` ya existía (bloquea role_id/verified/price_list_id/capacidades a
--    quien no es Dirección). Se conserva íntegro y se añade, ANTES de la excepción de
--    Dirección, la regla nueva: `active` y `role_id` no se editan a mano, ni siquiera
--    desde Dirección. Pasan el propio comando (app.trusted) y la administración del
--    servidor (service_role: staff-admin, invite-doctor, register-doctor, fixtures).
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if coalesce(current_setting('app.trusted', true), '') = 'on'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  -- W6-A1: la autoridad de acceso y el rol solo cambian por comando (Dirección incluida).
  if new.active is distinct from old.active then
    raise exception 'ACCESO_SOLO_POR_COMANDO: el acceso del personal se suspende o reactiva con el comando, no editando el perfil.';
  end if;
  if new.role_id is distinct from old.role_id then
    raise exception 'ROL_SOLO_POR_COMANDO: el rol se cambia desde Equipo (servidor), no editando el perfil.';
  end if;
  if public.auth_role() = 'admin' then
    return new;
  end if;
  if new.verified is distinct from old.verified
     or new.price_list_id is distinct from old.price_list_id
     or (coalesce(new.meta -> 'capabilities', 'null'::jsonb) is distinct from coalesce(old.meta -> 'capabilities', 'null'::jsonb)) then
    raise exception 'No autorizado: no puedes modificar role_id, verified, price_list_id ni capacidades';
  end if;
  return new;
end;
$$;
-- El trigger `profiles_guard_trg` ya existe y apunta a esta función.

-- ---------------------------------------------------------------------------
-- 3b) La bitácora de la app tampoco acepta a un suspendido (`log_audit` solo miraba
--     auth.uid(); era el único RPC autenticado sin pasar por auth_role()).
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(p_action text, p_resource text, p_detail text, p_actor_name text)
  returns void language plpgsql security definer set search_path = public as
$$
declare real_name text;
begin
  perform public.auth_role();   -- W6-A1: lanza CUENTA_SUSPENDIDA si la cuenta está suspendida
  select coalesce(meta ->> 'name', full_name, email) into real_name from public.profiles where id = auth.uid();
  insert into public.audit_logs(actor, action, resource_type, resource_id, payload)
  values (auth.uid(), p_action, 'app', p_resource,
    jsonb_build_object('actor_name', coalesce(real_name, p_actor_name), 'area', p_actor_name, 'detail', p_detail));
end; $$;

-- ---------------------------------------------------------------------------
-- 4) Comandos
-- ---------------------------------------------------------------------------
create function public._staff_objetivo(p_uid uuid) returns public.profiles
  language plpgsql stable set search_path = public as
$$
declare v public.profiles;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección administra el acceso del personal';
  end if;
  if p_uid is null then raise exception 'STAFF_INEXISTENTE: falta el usuario'; end if;
  if p_uid = auth.uid() then
    raise exception 'AUTOSUSPENSION_PROHIBIDA: no puedes cambiar tu propio acceso';
  end if;
  select * into v from public.profiles where id = p_uid;
  if not found then raise exception 'STAFF_INEXISTENTE: ese usuario no existe'; end if;
  if v.role_id is null or v.role_id = 'doctor' then
    raise exception 'SOLO_STAFF: los doctores no se suspenden por aquí; su acceso se gobierna con la verificación';
  end if;
  return v;
end;
$$;

-- Suspende (o da de baja, p_baja = true: misma autoridad, marca informativa). Idempotente:
-- un suspendido que se vuelve a suspender devuelve already_applied sin pisar la marca.
create function public.suspender_staff(p_uid uuid, p_motivo text, p_baja boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v public.profiles; v_marca jsonb;
begin
  v := public._staff_objetivo(p_uid);
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO: escribe el motivo de la suspensión';
  end if;
  if not v.active then
    return jsonb_build_object('status', 'already_applied', 'uid', p_uid, 'active', false);
  end if;
  v_marca := jsonb_build_object('motivo', left(btrim(p_motivo), 400), 'at', now(), 'por', auth.uid(),
                                'baja', coalesce(p_baja, false));
  perform set_config('app.trusted', 'on', true);
  update public.profiles
     set active = false,
         meta = coalesce(meta, '{}'::jsonb) - 'active'
                || jsonb_build_object('suspension', v_marca)
                || case when coalesce(p_baja, false) then jsonb_build_object('baja', v_marca) else '{}'::jsonb end
   where id = p_uid;
  perform set_config('app.trusted', 'off', true);
  insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
  values (auth.uid(), case when coalesce(p_baja, false) then 'Baja de personal' else 'Acceso suspendido' end,
          'profiles', p_uid::text,
          jsonb_build_object('nombre', coalesce(v.meta ->> 'name', v.full_name, v.email), 'rol', v.role_id,
                             'motivo', left(btrim(p_motivo), 400), 'baja', coalesce(p_baja, false)));
  return jsonb_build_object('status', 'applied', 'uid', p_uid, 'active', false, 'baja', coalesce(p_baja, false));
end;
$$;

create function public.reactivar_staff(p_uid uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v public.profiles;
begin
  v := public._staff_objetivo(p_uid);
  if v.active then
    return jsonb_build_object('status', 'already_applied', 'uid', p_uid, 'active', true);
  end if;
  perform set_config('app.trusted', 'on', true);
  -- La marca de la suspensión se conserva como historia (con su fecha de reactivación).
  update public.profiles
     set active = true,
         meta = (coalesce(meta, '{}'::jsonb) - 'baja')
                || jsonb_build_object('suspension', coalesce(meta -> 'suspension', '{}'::jsonb)
                                                     || jsonb_build_object('reactivada_at', now(), 'reactivada_por', auth.uid()))
   where id = p_uid;
  perform set_config('app.trusted', 'off', true);
  insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
  values (auth.uid(), 'Acceso reactivado', 'profiles', p_uid::text,
          jsonb_build_object('nombre', coalesce(v.meta ->> 'name', v.full_name, v.email), 'rol', v.role_id));
  return jsonb_build_object('status', 'applied', 'uid', p_uid, 'active', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Privilegios
-- ---------------------------------------------------------------------------
revoke all on function public._cuenta_suspendida(), public._staff_objetivo(uuid) from public, anon, authenticated;
revoke all on function public.suspender_staff(uuid, text, boolean), public.reactivar_staff(uuid) from public, anon;
grant execute on function public.suspender_staff(uuid, text, boolean), public.reactivar_staff(uuid) to authenticated;
