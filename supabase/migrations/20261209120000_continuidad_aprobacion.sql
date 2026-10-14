-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CONTINUIDAD AL APROBAR (migración 156) · LA CONVERSACIÓN DEL ENLACE SIGUE AUNQUE SE REGISTRE EN OTRO DISPOSITIVO
--   En el mismo navegador, el registro ya liga la conversación del enlace de contacto. Si se registró en OTRO
--   dispositivo, no había cómo. Ahora, al APROBAR la verificación (Dirección o su vendedor, que ya revisaron su
--   identidad), el prerregistro con su MISMO correo —uno solo, sin cuenta— se adopta: su conversación y su historial
--   pasan a la cuenta. Escribir el correo de otro en el enlace no basta: hace falta que una persona apruebe.
--   · _ligar_prerregistro(perfil)   NUEVA (interna). Vincula y adopta el prerregistro único con ese correo.
--   · doctor_verificar, admin_approve_doctor   un cambio: la llaman al aprobar.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/continuidad/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._ligar_prerregistro(uuid)') is not null then raise exception 'CONTINUIDAD: ya aplicada'; end if;
  if md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) <> '2125839d158c065129007966c969a4f9'
     or md5(pg_get_functiondef('public.admin_approve_doctor(uuid,uuid,jsonb)'::regprocedure)) <> 'ae578fcf8652206d6db0c611d7a4a5ef' then
    raise exception 'CONTINUIDAD: doctor_verificar / admin_approve_doctor no son las versiones auditadas';
  end if;
end $pre$;

create function public._ligar_prerregistro(p_profile uuid) returns int
  language plpgsql security definer set search_path = public as
$$
declare v_email text; v_vis uuid; v_n int;
begin
  select lower(btrim(email)) into v_email from public.profiles where id = p_profile and role_id = 'doctor';
  if v_email is null or v_email = '' then return 0; end if;
  select count(*), min(v.id::text)::uuid into v_n, v_vis
    from public.cc_prerregistros r join public.cc_visitors v on v.id = r.visitor_id
   where r.email = v_email and v.estado = 'activo' and (v.pending_profile_id is null or v.pending_profile_id = p_profile);
  if v_n <> 1 then return 0; end if;   -- ninguno o ambiguo: no se adivina
  update public.cc_visitors set pending_profile_id = p_profile, pending_at = coalesce(pending_at, now()) where id = v_vis;
  insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v_vis, 'registro', jsonb_build_object('via', 'aprobacion'), auth.uid());
  perform public.cc_visitante_adoptar(null, p_profile);
  return 1;
end;
$$;
alter function public._ligar_prerregistro(uuid) owner to postgres;
revoke all on function public._ligar_prerregistro(uuid) from public, anon, authenticated;
grant execute on function public._ligar_prerregistro(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.doctor_verificar(p_profile uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Aprueba o rechaza la verificación de un doctor. Aprobar = su expediente de cliente queda ligado (el que ya tenía,
-- el único con su mismo correo sin cuenta, o uno nuevo) y la cuenta se verifica. Quién lo aprobó queda registrado.
declare p record; v_c uuid; v_nota text := nullif(btrim(left(coalesce(p_nota, ''), 300)), ''); v_rol text := public.auth_role();
        v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_n int;
begin
  if not public._puede_verificar(p_profile) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  if p_aprobar is null then raise exception 'DECISION_INVALIDA' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_profile::text));
  select id, full_name, email, verified, meta into p from public.profiles where id = p_profile and role_id = 'doctor' for update;
  if not found then raise exception 'DOCTOR_INEXISTENTE' using errcode = 'check_violation'; end if;
  if p.verified then return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'idempotente', true); end if;
  if not p_aprobar then
    if v_nota is null then raise exception 'NOTA_REQUERIDA: explica por qué se rechaza' using errcode = 'check_violation'; end if;
    perform set_config('app.trusted', 'on', true);
    update public.profiles set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'rejected', 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'reason', v_nota)) where id = p_profile;
    perform set_config('app.trusted', v_trusted, true);
    select id into v_c from public.customers where profile_id = p_profile limit 1;
    if v_c is not null then perform public._c360_evento(v_c, 'verificacion_rechazada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end); end if;
    -- Aviso al doctor dentro del sistema (el portal además lo detecta solo): el motivo lo ve en "Mi verificación".
    perform public._cc_notificar('verificacion_rechazada', null, array[p_profile], null, 'Tu verificación no fue aprobada: ' || v_nota || '. Corrige tus datos en "Mi verificación".', 'mi_verificacion', 'verif_rechazo:' || p_profile::text || ':' || extract(epoch from now())::bigint::text);
    return jsonb_build_object('profile_id', p_profile, 'verificado', false, 'estado', 'rejected');
  end if;
  select id into v_c from public.customers where profile_id = p_profile order by active desc, created_at limit 1;
  if v_c is null and p.email is not null then
    select count(*), min(id::text)::uuid into v_n, v_c from public.customers where profile_id is null and active and lower(btrim(email)) = lower(btrim(p.email));
    if v_n <> 1 then v_c := null; end if;
    if v_c is not null then update public.customers set profile_id = p_profile, updated_at = now() where id = v_c; end if;
  end if;
  if v_c is null then
    insert into public.customers (full_name, email, phone, city, source, profile_id, active)
    values (coalesce(nullif(p.full_name, ''), p.meta ->> 'name', 'Doctor'), p.email, nullif(p.meta -> 'shipping' ->> 'phone', ''), nullif(p.meta -> 'shipping' ->> 'city', ''), 'portal', p_profile, true)
    returning id into v_c;
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.profiles set verified = true,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'verified', 'via', case when v_rol = 'admin' then 'direccion' else 'vendedor' end, 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'reason', v_nota))
   where id = p_profile;
  perform set_config('app.trusted', v_trusted, true);
  if v_rol = 'pos' and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_profile, auth.uid(), now(), auth.uid(), 'Lo verificó su vendedor');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_profile, null, auth.uid(), auth.uid(), 'Lo verificó su vendedor');
  end if;
  perform public._ligar_prerregistro(p_profile);   -- otro dispositivo: su conversación del enlace pasa a su cuenta
  perform public._c360_evento(v_c, 'verificacion_aprobada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  perform public._cc_notificar('verificacion_aprobada', null, array[p_profile], null, 'Tu cuenta Renovacell fue verificada: ya puedes ver precios y hacer pedidos.', 'catalogo', 'verif_ok:' || p_profile::text);
  return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'customer_id', v_c, 'idempotente', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_approve_doctor(p_profile uuid, p_customer_id uuid DEFAULT NULL::uuid, p_new_customer jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  perform public._ligar_prerregistro(p_profile);   -- otro dispositivo: su conversación del enlace pasa a su cuenta

  -- Cierra el lazo prospect ↔ customer para conversiones (determinista: convertedDoctorId = ESTE profile).
  update public.prospects
     set customer_id = v_customer
   where customer_id is null
     and meta->>'convertedDoctorId' = p_profile::text;

  return jsonb_build_object('ok', true, 'customer_id', v_customer);
end;
$function$;

do $post$ begin
  if md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) <> '308e2af98f8cb9bbd246202d47453393'
     or md5(pg_get_functiondef('public.admin_approve_doctor(uuid,uuid,jsonb)'::regprocedure)) <> '1341a6ea2d5c683ae36b9b7fe4b2a4e4' then
    raise exception 'CONTINUIDAD: las funciones no quedaron con la definición esperada';
  end if;
end $post$;
