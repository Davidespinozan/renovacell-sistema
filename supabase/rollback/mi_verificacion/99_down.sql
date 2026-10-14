-- MI VERIFICACIÓN · rollback de la migración 155. Aplicar en UNA transacción.
do $pre$ begin
  if md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) <> '2125839d158c065129007966c969a4f9' then raise exception 'MI-VERIFICACION rollback: doctor_verificar no es la de la 155'; end if;
end $pre$;
drop function public.mi_verificacion();
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
$function$;
do $post$ begin
  if md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) <> '8cf4dbc5e9e32d09f5b125f51d92c6ad' then raise exception 'MI-VERIFICACION rollback: doctor_verificar no volvió'; end if;
end $post$;
