-- ============================================================================
-- IA MEJOR QUE EL HUMANO · E (2 nov 2026) · VÍNCULO EXPLÍCITO WhatsApp ↔ doctor, para que la IA lo reconozca en WhatsApp.
-- R4-B1 (26 oct) apagó la liga automática por teléfono: el teléfono del perfil lo escribe el propio doctor sin confirmarlo,
-- así que coincidir número no prueba identidad (ni con `verified`). Esto NO la reabre: el vínculo es explícito y probado.
--   · Por código: el doctor, con SU sesión del portal, pide un código (RC-123456, 20 min) y lo manda desde su WhatsApp a
--     nuestro número. Llega con su wa_id (Meta lo garantiza) y el código prueba que quien tiene ese WhatsApp tiene la cuenta.
--   · Por personal: Dirección lo vincula a mano (tras confirmarlo con el doctor).
-- El vínculo NO fusiona conversaciones ni cambia cc_wa_contactos.profile_id (la conversación de WhatsApp sigue siendo la
-- suya, con su canal; así nada del portal sale por WhatsApp). Solo le dice a la IA de ESA conversación quién es el doctor
-- (cc_ia_identidad_canal): precios con su lista, su perfil, cotizaciones y el estado de sus pedidos. Se quita cuando quiera.
-- ============================================================================
alter table public.cc_wa_contactos add column if not exists vinculo_profile_id uuid references public.profiles(id) on delete set null;
alter table public.cc_wa_contactos add column if not exists vinculado_at timestamptz;
alter table public.cc_wa_contactos add column if not exists vinculado_via text check (vinculado_via in ('codigo', 'personal'));
alter table public.cc_wa_contactos add column if not exists vinculado_por uuid;
alter table public.cc_wa_config add column if not exists numero_publico text not null default '526671647799' check (numero_publico ~ '^[0-9]{10,15}$');

create table if not exists public.cc_wa_codigos (
  codigo text primary key check (codigo ~ '^RC-[0-9]{6}$'),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expira_at timestamptz not null, usado_at timestamptz, created_at timestamptz not null default now());
create index if not exists cc_wa_codigos_perfil on public.cc_wa_codigos (profile_id);
alter table public.cc_wa_codigos enable row level security;
revoke all on public.cc_wa_codigos from public, anon, authenticated;

-- ── 1 · Doctor (su sesión): pedir código, ver y quitar su vínculo ─────────────────────────────────
create or replace function public.wa_vinculo_codigo() returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_cod text; v_num text; i int := 0;
begin
  if v_uid is null or public._cc_perfil_activo(v_uid) is distinct from 'doctor' or not coalesce((select verified from public.profiles where id = v_uid), false) then
    raise exception 'NO_AUTORIZADO: solo un doctor verificado conecta su WhatsApp' using errcode = 'insufficient_privilege';
  end if;
  delete from public.cc_wa_codigos where profile_id = v_uid or expira_at < now() - interval '1 day';
  loop
    v_cod := 'RC-' || lpad((floor(random() * 1000000))::int::text, 6, '0'); i := i + 1;
    begin
      insert into public.cc_wa_codigos (codigo, profile_id, expira_at) values (v_cod, v_uid, now() + interval '20 minutes');
      exit;
    exception when unique_violation then if i > 5 then raise; end if;
    end;
  end loop;
  select numero_publico into v_num from public.cc_wa_config where id;
  return jsonb_build_object('codigo', v_cod, 'expira_at', now() + interval '20 minutes', 'numero', v_num,
    'enlace', 'https://wa.me/' || v_num || '?text=' || replace('Conectar mi WhatsApp ' || v_cod, ' ', '%20'));
end;
$$;

create or replace function public.wa_vinculo_estado() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_build_object('vinculado', true, 'numero', '•••• ' || right(k.wa_id, 4), 'desde', k.vinculado_at, 'via', k.vinculado_via)
                     from public.cc_wa_contactos k where k.vinculo_profile_id = auth.uid() order by k.vinculado_at desc limit 1),
                  jsonb_build_object('vinculado', false));
end;
$$;

create or replace function public.wa_vinculo_quitar() returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_wa_contactos set vinculo_profile_id = null, vinculado_at = null, vinculado_via = null, vinculado_por = null where vinculo_profile_id = auth.uid();
  get diagnostics n = row_count;
  return jsonb_build_object('quitados', n);
end;
$$;

-- ── 2 · Servidor: el código llega por WhatsApp ────────────────────────────────────────────────────
create or replace function public._cc_wa_aviso(p_conv uuid, p_wa text, p_texto text) returns void
  language plpgsql security definer set search_path = public as
$$
declare v_seq bigint;
begin
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = p_conv returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (p_conv, v_seq, 'ai', 'tpl:wa_vinculo:' || p_wa || ':' || v_seq, p_texto, md5(p_texto));
end;
$$;

create or replace function public.cc_wa_vincular(p_wa_id text, p_codigo text, p_conv uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c public.cc_wa_codigos; k public.cc_wa_contactos; v_nombre text; v_t text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into k from public.cc_wa_contactos where wa_id = p_wa_id for update;
  if not found or (public._cc_wa_contacto_de(p_conv)).wa_id is distinct from p_wa_id then raise exception 'WA_CONTACTO_INVALIDO' using errcode = 'check_violation'; end if;
  select * into c from public.cc_wa_codigos where codigo = upper(btrim(p_codigo)) for update;
  if not found or c.usado_at is not null or c.expira_at < now() or public._cc_perfil_activo(c.profile_id) is distinct from 'doctor'
     or not coalesce((select verified from public.profiles where id = c.profile_id), false) then
    v_t := 'Ese código no es válido o ya venció. Entra a tu cuenta de Renovacell, toca "Conectar mi WhatsApp" y mándame el código nuevo.';
    perform public._cc_wa_aviso(p_conv, p_wa_id, v_t);
    return jsonb_build_object('ok', false, 'texto', v_t);
  end if;
  if k.vinculo_profile_id is not null and k.vinculo_profile_id <> c.profile_id then
    v_t := 'Este WhatsApp ya está conectado a otra cuenta. Si es un error, pídele a tu asesor de Renovacell que lo revise.';
    perform public._cc_wa_aviso(p_conv, p_wa_id, v_t);
    return jsonb_build_object('ok', false, 'texto', v_t);
  end if;
  update public.cc_wa_contactos set vinculo_profile_id = c.profile_id, vinculado_at = now(), vinculado_via = 'codigo', vinculado_por = c.profile_id where wa_id = p_wa_id;
  update public.cc_wa_codigos set usado_at = now() where codigo = c.codigo;
  v_nombre := public._cc_primer_nombre((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id));
  v_t := '¡Listo' || coalesce(', ' || v_nombre, '') || '! Ya reconozco tu WhatsApp: por aquí puedo darte tus precios, cotizarte y decirte cómo van tus pedidos. ¿En qué te ayudo?';
  perform public._cc_wa_aviso(p_conv, p_wa_id, v_t);
  return jsonb_build_object('ok', true, 'texto', v_t, 'profile_id', c.profile_id);
end;
$$;

-- La IA de una conversación de WhatsApp: ¿a qué doctor representa? Solo con vínculo explícito y doctor verificado activo.
create or replace function public.cc_ia_identidad_canal(p_conv uuid) returns uuid
  language plpgsql stable security definer set search_path = public as
$$
declare v_wa text; v_p uuid;
begin
  perform public._cc_solo_servicio();
  v_wa := (public._cc_wa_contacto_de(p_conv)).wa_id;
  if v_wa is null then return null; end if;
  select vinculo_profile_id into v_p from public.cc_wa_contactos where wa_id = v_wa and vinculado_via in ('codigo', 'personal');
  if v_p is null or public._cc_perfil_activo(v_p) is distinct from 'doctor' or not coalesce((select verified from public.profiles where id = v_p), false) then return null; end if;
  return v_p;
end;
$$;

-- ── 3 · Dirección: vincular o quitar a mano (tras confirmarlo con el doctor) ──────────────────────
create or replace function public.wa_vinculo_personal(p_conv uuid, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_wa text;
begin
  perform public._cc_exige_admin();
  v_wa := (public._cc_wa_contacto_de(p_conv)).wa_id;
  if v_wa is null then raise exception 'NO_ES_WHATSAPP: esa conversación no es de WhatsApp' using errcode = 'check_violation'; end if;
  if p_profile is null then
    update public.cc_wa_contactos set vinculo_profile_id = null, vinculado_at = null, vinculado_via = null, vinculado_por = null where wa_id = v_wa;
    return jsonb_build_object('vinculado', false);
  end if;
  if public._cc_perfil_activo(p_profile) is distinct from 'doctor' or not coalesce((select verified from public.profiles where id = p_profile), false) then
    raise exception 'PERFIL_INVALIDO: solo un doctor verificado y activo' using errcode = 'check_violation';
  end if;
  update public.cc_wa_contactos set vinculo_profile_id = p_profile, vinculado_at = now(), vinculado_via = 'personal', vinculado_por = auth.uid() where wa_id = v_wa;
  return jsonb_build_object('vinculado', true, 'profile_id', p_profile);
end;
$$;

do $g$ begin
  execute 'revoke all on function public.wa_vinculo_codigo(), public.wa_vinculo_estado(), public.wa_vinculo_quitar(), public._cc_wa_aviso(uuid, text, text), public.cc_wa_vincular(text, text, uuid), public.cc_ia_identidad_canal(uuid), public.wa_vinculo_personal(uuid, uuid) from public, anon';
  execute 'grant execute on function public.wa_vinculo_codigo(), public.wa_vinculo_estado(), public.wa_vinculo_quitar(), public.wa_vinculo_personal(uuid, uuid) to authenticated';
  execute 'revoke all on function public._cc_wa_aviso(uuid, text, text), public.cc_wa_vincular(text, text, uuid), public.cc_ia_identidad_canal(uuid) from authenticated';
  execute 'grant execute on function public.cc_wa_vincular(text, text, uuid), public.cc_ia_identidad_canal(uuid) to service_role';
end $g$;

do $post$ begin
  -- R4-B1 sigue en pie: ninguna coincidencia de teléfono liga ni eleva a nadie.
  if public._cc_wa_perfil('5216671647799') is not null then raise exception 'WA-VINCULO: _cc_wa_perfil volvió a ligar por teléfono'; end if;
end $post$;
