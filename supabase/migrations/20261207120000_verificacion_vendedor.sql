-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POR VENDEDOR (migración 154) · EL VENDEDOR TAMBIÉN VERIFICA, Y TIENE HERRAMIENTAS EN EL CHAT
--   Decisión del dueño (14 oct 2026): el vendedor puede verificar a un doctor. Lo hace quien lo atiende: el vendedor
--   de su cartera o el que tiene asignada su conversación (y Dirección, siempre).
--   · _puede_verificar(perfil)        NUEVA. Dirección; o vendedor activo, que atiende conversaciones, con el doctor en
--                                      su cartera o con su conversación abierta asignada.
--   · doctor_verificacion_ver         NUEVA. Lo que se revisa: cédula, dictamen SEP, identidad y rutas de la evidencia.
--   · doctor_verificar                NUEVA. Aprueba (liga o crea su expediente de cliente, da acceso a precios y, si lo
--                                      aprueba un vendedor sin cartera previa, le queda en cartera) o rechaza con nota.
--   · doctor_verificacion_de_conversacion   NUEVA. Para el panel del chat: el doctor pendiente de ESA conversación.
--   · La evidencia (fotos del INE) NO abre el almacenamiento: la Edge `verificacion` firma enlaces temporales solo
--     después de que doctor_verificacion_ver autoriza al llamante (las políticas de proofs de SEC-C3 no cambian).
--   · cc_contacto_de                  un cambio: incluye el id del posible cliente (para invitarlo desde el chat).
--   NO cambia: admin_approve_doctor (Dirección conserva su flujo), precios, pedidos.
--   Depende de la 153. Aplicar en UNA transacción. Rollback: supabase/rollback/verificacion_vendedor/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.doctor_verificar(uuid,boolean,text)') is not null then raise exception 'VERIF-VENDEDOR: ya aplicada'; end if;
  if to_regclass('public.cliente_invitaciones') is null then raise exception 'VERIF-VENDEDOR: falta la 153'; end if;
  if md5(pg_get_functiondef('public.cc_contacto_de(uuid)'::regprocedure)) <> 'd6bc94190c8a5205f95920bce5027243'
     or md5(pg_get_functiondef('public.profiles_guard()'::regprocedure)) <> 'e6267b13b03215e08fefce7fdb417024' then
    raise exception 'VERIF-VENDEDOR: cc_contacto_de / profiles_guard no son las versiones auditadas';
  end if;
end $pre$;

alter table public.customer_events drop constraint ck_ce_tipo;
alter table public.customer_events add constraint ck_ce_tipo check (tipo = any (array['contacto_actualizado', 'telefono_agregado', 'telefono_actualizado', 'telefono_principal', 'telefono_archivado', 'domicilio_agregado', 'domicilio_actualizado', 'domicilio_predeterminado', 'domicilio_archivado', 'domicilio_adoptado_alta', 'fiscal_agregado', 'fiscal_actualizado', 'fiscal_predeterminado', 'fiscal_archivado', 'nota_agregada', 'migracion', 'vendedor_asignado', 'cliente_baja', 'cliente_reactivado', 'invitacion_creada', 'cuenta_creada', 'verificacion_aprobada', 'verificacion_rechazada']));

create function public._puede_verificar(p_profile uuid) returns boolean
  language sql stable security definer set search_path = public as
$$
  select p_profile is not null and auth.uid() is not null and (
    public.auth_role() = 'admin'
    or (public.auth_role() = 'pos' and public._cc_puede_atender(auth.uid()) and (
          exists (select 1 from public.cc_cartera k where k.profile_id = p_profile and k.seller_profile_id = auth.uid())
          or exists (select 1 from public.cc_conversations c where c.profile_id = p_profile and c.estado = 'abierta' and c.seller_profile_id = auth.uid()))))
$$;

create function public.doctor_verificacion_ver(p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare p record;
begin
  if not public._puede_verificar(p_profile) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  select id, full_name, email, verified, organization, meta into p from public.profiles where id = p_profile and role_id = 'doctor';
  if not found then raise exception 'DOCTOR_INEXISTENTE' using errcode = 'check_violation'; end if;
  return jsonb_build_object('profile_id', p.id, 'nombre', coalesce(nullif(p.full_name, ''), p.meta ->> 'name'), 'email', p.email,
    'telefono', p.meta -> 'shipping' ->> 'phone', 'organizacion', coalesce(p.organization, p.meta ->> 'organization'),
    'cedula', p.meta ->> 'cedula', 'verificado', p.verified, 'estado', coalesce(p.meta -> 'verification' ->> 'status', case when p.verified then 'verified' else 'pending' end),
    'sep', (p.meta -> 'verifyResult') - 'raw' - 'payload', 'identidad', p.meta -> 'identity' ->> 'status',
    'evidencia', coalesce(p.meta -> 'identity' -> 'evidence', '{}'::jsonb));
end;
$$;

create function public.doctor_verificar(p_profile uuid, p_aprobar boolean, p_nota text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
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
    update public.profiles set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'rejected', 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'nota', v_nota)) where id = p_profile;
    perform set_config('app.trusted', v_trusted, true);
    select id into v_c from public.customers where profile_id = p_profile limit 1;
    if v_c is not null then perform public._c360_evento(v_c, 'verificacion_rechazada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end); end if;
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
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('verification', jsonb_build_object('status', 'verified', 'via', case when v_rol = 'admin' then 'direccion' else 'vendedor' end, 'reviewed_at', now(), 'reviewed_by', auth.uid(), 'nota', v_nota))
   where id = p_profile;
  perform set_config('app.trusted', v_trusted, true);
  if v_rol = 'pos' and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_profile, auth.uid(), now(), auth.uid(), 'Lo verificó su vendedor');
    insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_profile, null, auth.uid(), auth.uid(), 'Lo verificó su vendedor');
  end if;
  perform public._c360_evento(v_c, 'verificacion_aprobada', jsonb_build_object('nota', v_nota), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  return jsonb_build_object('profile_id', p_profile, 'verificado', true, 'customer_id', v_c, 'idempotente', false);
end;
$$;

create function public.doctor_verificacion_de_conversacion(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_p uuid;
begin
  select c.profile_id into v_p from public.cc_conversations c join public.profiles p on p.id = c.profile_id where c.id = p_conv and p.role_id = 'doctor' and not p.verified;
  if v_p is null or not public._puede_verificar(v_p) then return null; end if;
  return public.doctor_verificacion_ver(v_p);
end;
$$;

CREATE OR REPLACE FUNCTION public.cc_contacto_de(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Datos de contacto que dejó quien escribe por el enlace. Solo Dirección o el asesor asignado a ESA conversación.
declare c record; r public.cc_prerregistros;
begin
  select id, visitor_id, profile_id, seller_profile_id into c from public.cc_conversations where id = p_conv;
  if not found or not (public.auth_role() = 'admin' or (c.seller_profile_id is not null and c.seller_profile_id = auth.uid() and public._cc_puede_atender(auth.uid()))) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  if c.visitor_id is null then return null; end if;
  select * into r from public.cc_prerregistros where visitor_id = c.visitor_id;
  if not found then return null; end if;
  return jsonb_build_object('nombre', r.nombre, 'telefono', r.telefono, 'email', r.email, 'es_medico', r.es_medico, 'cedula', r.cedula,
    'posible_cliente', (select cu.full_name from public.customers cu where cu.id = r.posible_customer_id),
    'posible_cliente_id', r.posible_customer_id,
    'confirmado', c.profile_id is not null, 'desde', r.created_at);
end;
$function$;

alter function public._puede_verificar(uuid) owner to postgres;
alter function public.doctor_verificacion_ver(uuid) owner to postgres;
alter function public.doctor_verificar(uuid, boolean, text) owner to postgres;
alter function public.doctor_verificacion_de_conversacion(uuid) owner to postgres;
revoke all on function public._puede_verificar(uuid) from public, anon;
grant execute on function public._puede_verificar(uuid) to authenticated, service_role;
revoke all on function public.doctor_verificacion_ver(uuid), public.doctor_verificar(uuid, boolean, text), public.doctor_verificacion_de_conversacion(uuid) from public, anon;
grant execute on function public.doctor_verificacion_ver(uuid), public.doctor_verificar(uuid, boolean, text), public.doctor_verificacion_de_conversacion(uuid) to authenticated, service_role;

do $post$ begin
  if md5(pg_get_functiondef('public.cc_contacto_de(uuid)'::regprocedure)) <> '5d74821846ae2e08ac78c4aaa8165b80' then raise exception 'VERIF-VENDEDOR: cc_contacto_de no quedó con la definición esperada'; end if;
  if has_function_privilege('anon', 'public.doctor_verificar(uuid,boolean,text)', 'execute') then raise exception 'VERIF-VENDEDOR: permisos inesperados'; end if;
end $post$;
