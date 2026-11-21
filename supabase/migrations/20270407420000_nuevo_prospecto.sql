-- NUEVO PROSPECTO (21 nov 2026, dueño: «les estamos limitando que prospecten por su cuenta» → «dale»).
-- Antes solo Dirección podía dar de alta clientes: una vendedora que conseguía un doctor nuevo (evento, visita, su
-- WhatsApp) no podía registrarlo, ni meterlo al embudo, ni escribirle por WhatsApp desde el sistema.
-- Ahora la vendedora (o Dirección) lo registra con nombre y celular; queda en SU cartera (plazo de 6 meses como todos),
-- con su oportunidad en «Primer contacto». Sin duplicados por celular:
--   · ya es suyo → regresa ese cliente;
--   · es de otra vendedora → NO se crea: dice de quién es (lo decide Dirección);
--   · existe sin vendedora → se le asigna a ella (no se crea otra ficha).
create or replace function public.cliente_prospecto_crear(p_nombre text, p_celular text, p_tipo text default 'doctor',
                                                          p_ciudad text default null, p_correo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_rol text := public.auth_role(); v_uid uuid := auth.uid();
  v_nom text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
  v_dig text := regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  v_mail text := nullif(lower(btrim(coalesce(p_correo, ''))), '');
  v_tel text; v_cli uuid; v_dueno uuid; v_estado text; v_op jsonb;
begin
  if v_rol not in ('pos', 'admin') then raise exception 'NO_AUTORIZADO: solo Ventas o Dirección registran prospectos' using errcode = 'insufficient_privilege'; end if;
  if v_nom is null or length(v_nom) < 3 or length(v_nom) > 120 then raise exception 'NOMBRE_REQUERIDO: escribe el nombre completo' using errcode = 'check_violation'; end if;
  if length(v_dig) = 12 and left(v_dig, 2) = '52' then v_dig := right(v_dig, 10); end if;
  if length(v_dig) = 13 and left(v_dig, 3) = '521' then v_dig := right(v_dig, 10); end if;
  if length(v_dig) <> 10 then raise exception 'CELULAR_INVALIDO: escribe el celular a 10 dígitos' using errcode = 'check_violation'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'CORREO_INVALIDO: revisa el correo' using errcode = 'check_violation'; end if;
  if coalesce(p_tipo, 'doctor') not in ('doctor', 'clinica') then raise exception 'TIPO_INVALIDO' using errcode = 'check_violation'; end if;
  v_tel := v_dig;

  -- ¿ese celular ya existe? (el más completo: con vendedora primero)
  select c.id, public._cc_vendedor_de_cliente(c.id) into v_cli, v_dueno
    from public.customers c
   where c.active and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = v_dig
   order by (public._cc_vendedor_de_cliente(c.id) is not null) desc, (c.email is not null) desc, c.created_at
   limit 1;

  if v_cli is not null then
    if v_dueno is not null and v_dueno <> v_uid and v_rol = 'pos' then
      raise exception 'PROSPECTO_DE_OTRA: ese celular ya es de «%», cliente de %. Si crees que debe ser tuyo, pídeselo a Dirección',
        (select initcap(lower(full_name)) from public.customers where id = v_cli),
        coalesce(public._cc_nombre_personal(v_dueno), 'otra vendedora') using errcode = 'check_violation';
    end if;
    if v_dueno is null and v_rol = 'pos' then
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_por, motivo)
      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora (ya existía sin vendedora)')
      on conflict (customer_id) do nothing;
      perform public._c360_evento(v_cli, 'vendedor_asignado', jsonb_build_object('vendedor', v_uid, 'motivo', 'prospecto'), v_rol);
      v_estado := 'asignado';
    else
      v_estado := 'existente';
    end if;
  else
    insert into public.customers (full_name, phone, email, city, country, source, tipo_cliente, meta)
    values (upper(v_nom), v_tel, v_mail, nullif(btrim(coalesce(p_ciudad, '')), ''), 'MX', 'vendedor', coalesce(p_tipo, 'doctor'),
            jsonb_build_object('prospecto', jsonb_build_object('por', v_uid, 'at', now())))
    returning id into v_cli;
    if v_rol = 'pos' then
      insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_por, motivo)
      values (v_cli, v_uid, v_uid, 'Prospecto registrado por la vendedora')
      on conflict (customer_id) do nothing;
    end if;
    perform public._c360_evento(v_cli, 'nota_agregada', jsonb_build_object('nota', 'Alta como prospecto', 'por', v_uid), v_rol);
    v_estado := 'creado';
  end if;

  -- su oportunidad en «Primer contacto» (si ya tiene una abierta, se respeta)
  begin
    v_op := public.crm_crear(v_cli, 'Prospecto', null);
  exception when others then v_op := null;
  end;

  insert into public.audit_logs (actor, action, resource_type, resource_id, payload)
  values (v_uid, 'Prospecto registrado', 'customers', v_cli::text, jsonb_build_object('estado', v_estado, 'nombre', upper(v_nom)));

  return jsonb_build_object('status', v_estado, 'customer_id', v_cli,
    'nombre', (select full_name from public.customers where id = v_cli), 'phone', (select phone from public.customers where id = v_cli),
    'oportunidad_id', v_op ->> 'id');
end;
$function$;
revoke all on function public.cliente_prospecto_crear(text,text,text,text,text) from public, anon;
grant execute on function public.cliente_prospecto_crear(text,text,text,text,text) to authenticated;
