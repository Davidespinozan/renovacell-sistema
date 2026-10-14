-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- INVITACIONES (migración 153) · LOS CLIENTES ACTUALES CREAN SU CUENTA POR INVITACIÓN, YA VERIFICADOS
--   Decisión del dueño (14 oct 2026): tener cuenta y estar verificado son cosas distintas. Los clientes que ya
--   compran (los de Odoo) se consideran verificados: desde su ficha, Dirección o su vendedor les manda una
--   invitación (por WhatsApp o correo); el cliente pone su contraseña y su cuenta nace LIGADA a su expediente
--   (historial, domicilios, datos fiscales, vendedor) y VERIFICADA, sin repetir el trámite.
--   · cliente_invitaciones           NUEVA. Una invitación vigente por cliente; el enlace lleva un secreto que la base
--                                     guarda solo como huella (sha256). Vence en 14 días; usarla la cierra.
--   · cliente_invitacion_crear       NUEVA (Dirección o el vendedor asignado). Revoca la anterior y devuelve el secreto
--                                     UNA vez, para armar el enlace.
--   · cliente_invitacion_ver         NUEVA (servidor). ¿El enlace sirve? Nombre y correo sugerido.
--   · cliente_invitacion_aceptar     NUEVA (servidor). Liga la cuenta recién creada al expediente y la verifica.
--   NO cambia: el registro público, la aprobación de Dirección, precios ni pedidos.
--   Depende de la 152. Aplicar en UNA transacción. Rollback: supabase/rollback/invitaciones/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cliente_invitaciones') is not null then raise exception 'INVITACIONES: ya aplicada'; end if;
  if to_regclass('public.cc_cartera_clientes') is null then raise exception 'INVITACIONES: falta la 152'; end if;
  if md5(pg_get_functiondef('public.profiles_guard()'::regprocedure)) <> 'e6267b13b03215e08fefce7fdb417024'
     or md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) <> 'd31936c0f165c984cd4cf28362d91a52' then
    raise exception 'INVITACIONES: profiles_guard / handle_new_user no son las versiones auditadas';
  end if;
end $pre$;

alter table public.customer_events drop constraint ck_ce_tipo;
alter table public.customer_events add constraint ck_ce_tipo check (tipo = any (array['contacto_actualizado', 'telefono_agregado', 'telefono_actualizado', 'telefono_principal', 'telefono_archivado', 'domicilio_agregado', 'domicilio_actualizado', 'domicilio_predeterminado', 'domicilio_archivado', 'domicilio_adoptado_alta', 'fiscal_agregado', 'fiscal_actualizado', 'fiscal_predeterminado', 'fiscal_archivado', 'nota_agregada', 'migracion', 'vendedor_asignado', 'cliente_baja', 'cliente_reactivado', 'invitacion_creada', 'cuenta_creada']));

create table public.cliente_invitaciones (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  creada_por   uuid references public.profiles(id) on delete set null,
  creada_at    timestamptz not null default now(),
  expira_at    timestamptz not null default now() + interval '14 days',
  usada_at     timestamptz,
  profile_id   uuid references public.profiles(id) on delete set null,
  revocada_at  timestamptz,
  check ((usada_at is null) = (profile_id is null))
);
comment on table public.cliente_invitaciones is 'INVITACIONES · enlace personal para que un cliente existente cree su cuenta ya verificada. Solo se guarda la huella del secreto.';
create unique index uq_cliente_invitacion_vigente on public.cliente_invitaciones (customer_id) where usada_at is null and revocada_at is null;
alter table public.cliente_invitaciones enable row level security;   -- sin políticas: solo comandos
revoke all on table public.cliente_invitaciones from public, anon, authenticated;
grant select, insert, update on table public.cliente_invitaciones to service_role;

create function public.cliente_invitacion_crear(p_customer uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- Dirección o el vendedor asignado invitan a un cliente sin cuenta. El secreto viaja UNA vez (para el enlace);
-- la base guarda su huella. Una invitación nueva revoca la anterior.
declare a text := public._c360_actor(p_customer); c record; v_token text; v_inv public.cliente_invitaciones; v_tel text;
begin
  if a is null or a not in ('direccion', 'vendedor', 'servicio') then
    raise exception 'NO_AUTORIZADO: solo Dirección o el vendedor del cliente invitan' using errcode = 'insufficient_privilege';
  end if;
  select id, full_name, email, phone, profile_id, active into c from public.customers where id = p_customer for update;
  if not found then raise exception 'CLIENTE_INEXISTENTE' using errcode = 'check_violation'; end if;
  if c.profile_id is not null then raise exception 'YA_TIENE_CUENTA: este cliente ya tiene cuenta en el portal' using errcode = 'check_violation'; end if;
  if not c.active then raise exception 'CLIENTE_INACTIVO: reactiva al cliente antes de invitarlo' using errcode = 'check_violation'; end if;
  update public.cliente_invitaciones set revocada_at = now() where customer_id = p_customer and usada_at is null and revocada_at is null;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.cliente_invitaciones (customer_id, token_hash, creada_por)
  values (p_customer, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid()) returning * into v_inv;
  perform public._c360_evento(p_customer, 'invitacion_creada', jsonb_build_object('expira', v_inv.expira_at), a);
  select t.numero into v_tel from public.customer_phones t where t.customer_id = p_customer and t.activo order by t.es_principal desc, t.created_at limit 1;
  return jsonb_build_object('token', v_token, 'expira_at', v_inv.expira_at, 'nombre', c.full_name, 'email', c.email, 'telefono', coalesce(v_tel, c.phone));
end;
$$;

create function public.cliente_invitacion_ver(p_hash text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare i public.cliente_invitaciones; c record;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('estado', 'inexistente'); end if;
  select * into i from public.cliente_invitaciones where token_hash = p_hash;
  if not found then return jsonb_build_object('estado', 'inexistente'); end if;
  if i.usada_at is not null then return jsonb_build_object('estado', 'usada'); end if;
  if i.revocada_at is not null then return jsonb_build_object('estado', 'revocada'); end if;
  if i.expira_at < now() then return jsonb_build_object('estado', 'expirada'); end if;
  select full_name, email, profile_id, active into c from public.customers where id = i.customer_id;
  if c.profile_id is not null then return jsonb_build_object('estado', 'usada'); end if;
  if not c.active then return jsonb_build_object('estado', 'revocada'); end if;
  return jsonb_build_object('estado', 'valida', 'nombre', c.full_name, 'email', c.email);
end;
$$;

create function public.cliente_invitacion_aceptar(p_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- La cuenta recién creada (Edge, service_role) se liga al expediente del cliente y nace VERIFICADA: es un cliente
-- que ya compra y lo invitó alguien del equipo. Todo o nada: si algo no cuadra, la Edge borra la cuenta creada.
declare i public.cliente_invitaciones; c record; p record;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVITACION_INVALIDA'; end if;
  select * into i from public.cliente_invitaciones where token_hash = p_hash for update;
  if not found then raise exception 'INVITACION_INVALIDA'; end if;
  if i.usada_at is not null then raise exception 'INVITACION_USADA'; end if;
  if i.revocada_at is not null then raise exception 'INVITACION_REVOCADA'; end if;
  if i.expira_at < now() then raise exception 'INVITACION_EXPIRADA'; end if;
  select id, full_name, profile_id, active into c from public.customers where id = i.customer_id for update;
  if c.profile_id is not null then raise exception 'INVITACION_USADA'; end if;
  if not c.active then raise exception 'INVITACION_REVOCADA'; end if;
  select id, role_id into p from public.profiles where id = p_profile;
  if not found or p.role_id <> 'doctor' then raise exception 'PERFIL_INVALIDO'; end if;
  if exists (select 1 from public.customers where profile_id = p_profile) then raise exception 'PERFIL_YA_LIGADO'; end if;
  update public.customers set profile_id = p_profile, updated_at = now() where id = c.id;   -- el trigger de cartera hereda el vendedor
  update public.profiles
     set verified = true,
         full_name = coalesce(nullif(btrim(full_name), ''), c.full_name),
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
           'verification', jsonb_build_object('status', 'verified', 'via', 'cliente_existente', 'reviewed_at', now(), 'reviewed_by', i.creada_por, 'invitacion', i.id))
   where id = p_profile;
  update public.cliente_invitaciones set usada_at = now(), profile_id = p_profile where id = i.id;
  perform public._c360_evento(c.id, 'cuenta_creada', jsonb_build_object('via', 'invitacion'), 'servicio');
  return jsonb_build_object('customer_id', c.id, 'profile_id', p_profile, 'verificado', true);
end;
$$;

alter function public.cliente_invitacion_crear(uuid) owner to postgres;
alter function public.cliente_invitacion_ver(text) owner to postgres;
alter function public.cliente_invitacion_aceptar(text, uuid) owner to postgres;
revoke all on function public.cliente_invitacion_crear(uuid) from public, anon;
revoke all on function public.cliente_invitacion_ver(text) from public, anon, authenticated;
revoke all on function public.cliente_invitacion_aceptar(text, uuid) from public, anon, authenticated;
grant execute on function public.cliente_invitacion_crear(uuid) to authenticated, service_role;
grant execute on function public.cliente_invitacion_ver(text) to service_role;
grant execute on function public.cliente_invitacion_aceptar(text, uuid) to service_role;

do $post$ begin
  if has_function_privilege('anon', 'public.cliente_invitacion_crear(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.cliente_invitacion_aceptar(text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.cliente_invitacion_ver(text)', 'execute')
     or has_table_privilege('authenticated', 'public.cliente_invitaciones', 'select') then
    raise exception 'INVITACIONES: permisos inesperados';
  end if;
end $post$;
