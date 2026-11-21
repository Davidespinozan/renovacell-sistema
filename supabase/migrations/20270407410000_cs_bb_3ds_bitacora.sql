-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CS-BB · CyberSource / BanBajío alineado al MANUAL DE INTEGRACIÓN del banco (21 nov 2026)
--   1) `card_payment_3ds_auth`: datos 3DS de CORTA VIDA por intento (jti del token transitorio, su expiración, marca y los
--      valores que la venta exige por marca: cavv, xid, eciRaw, ucaf*, directoryServerTransactionId, specificationVersion,
--      ecommerceIndicator, paresStatus, authenticationTransactionId). Los escribe cs-3ds y los lee cs-pago. SOLO servidor:
--      RLS encendida y ningún permiso para anon/authenticated. Se borra al terminar el intento (cs-pago, tras enviar la venta)
--      o a la hora (cs_intentos_expirar, la tarea de cada 5 min ya existente). Nunca PAN ni CVV (no existen en el servidor).
--   2) `card_payment_attempts.cs_processor_transaction_id`: processorInformation.transactionId de la venta (manual §11.4);
--      reconciliationId ya se guardaba en cs_reconciliation_id. Escritura por la RPC `cs_intento_procesador` (solo servidor).
--   3) `cs_bitacora_pruebas`: BITÁCORA DE PRUEBAS de certificación (casos 3DS 2.1–2.11) — cada llamada a CyberSource de un
--      intento en SANDBOX: paso, hora, estatus HTTP y cuerpos ENMASCARADOS (los enmascara la Edge antes de guardar). Solo
--      ambiente 'test' (restricción): producción nunca registra cuerpos. Lectura solo de Dirección por RPC; inserción solo servidor.
--   4) `cs_intentos_expirar()` (misma firma y misma expiración de la 184) además limpia los datos 3DS vencidos o de intentos ya
--      terminados.
--   Sin cambios a la máquina de estados ni a cs_intento_avanzar. Rollback: supabase/rollback/cs_bb_3ds/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.card_payment_attempts') is null or to_regprocedure('public.cs_intentos_expirar()') is null then raise exception 'CS-BB: falta CS-1A.1a'; end if;
  if to_regclass('public.card_payment_3ds_auth') is not null then raise exception 'CS-BB: ya aplicada'; end if;
end $pre$;

-- ---------------------------------------------------------------------------------------------------
-- 1) Datos 3DS de corta vida (solo servidor)
-- ---------------------------------------------------------------------------------------------------
create table public.card_payment_3ds_auth (
  attempt_id                        uuid primary key references public.card_payment_attempts(id) on delete cascade,
  jti                               text not null check (jti ~ '^[A-Za-z0-9_-]{1,128}$'),
  token_exp                         timestamptz not null,
  card_brand                        text check (card_brand is null or card_brand in ('visa','mastercard','amex','carnet')),
  authentication_transaction_id     text,
  pares_status                      text,
  eci                               text,
  eci_raw                           text,
  cavv                              text,
  xid                               text,
  ucaf_collection_indicator         text,
  ucaf_authentication_data          text,
  directory_server_transaction_id   text,
  specification_version             text,
  ecommerce_indicator               text,
  fuente                            text not null default 'setup' check (fuente in ('setup','enroll','validate')),
  created_at                        timestamptz not null default clock_timestamp(),
  updated_at                        timestamptz not null default clock_timestamp(),
  expires_at                        timestamptz not null default clock_timestamp() + interval '1 hour'
);
comment on table public.card_payment_3ds_auth is
  'CS-BB · valores 3DS de un intento entre cs-3ds y cs-pago (jti, cavv/xid/ucaf, eci, ecommerceIndicator…). Corta vida (1 h o fin del intento). '
  'Solo service_role. Sin PAN ni CVV.';
create index idx_cp3a_expira on public.card_payment_3ds_auth (expires_at);
alter table public.card_payment_3ds_auth enable row level security;
revoke all on public.card_payment_3ds_auth from public, anon, authenticated;
grant select, insert, update, delete on public.card_payment_3ds_auth to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2) Id de transacción del procesador (venta)
-- ---------------------------------------------------------------------------------------------------
alter table public.card_payment_attempts add column cs_processor_transaction_id text;

create function public.cs_intento_procesador(p_attempt uuid, p_transaction_id text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_tx text := left(nullif(btrim(coalesce(p_transaction_id, '')), ''), 64);
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'NO_AUTORIZADO: solo el servidor registra el id del procesador' using errcode = 'insufficient_privilege';
  end if;
  if v_tx is null then return jsonb_build_object('status', 'sin_dato'); end if;
  update public.card_payment_attempts set cs_processor_transaction_id = coalesce(cs_processor_transaction_id, v_tx), updated_at = clock_timestamp()
   where id = p_attempt;
  if not found then raise exception 'INTENTO_INEXISTENTE' using errcode = 'no_data_found'; end if;
  return jsonb_build_object('status', 'applied', 'attempt_id', p_attempt);
end $$;
comment on function public.cs_intento_procesador(uuid, text) is 'CS-BB · guarda processorInformation.transactionId de la venta (una vez; solo servidor).';
revoke all on function public.cs_intento_procesador(uuid, text) from public, anon, authenticated;
grant execute on function public.cs_intento_procesador(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 3) Bitácora de pruebas de certificación (solo sandbox)
-- ---------------------------------------------------------------------------------------------------
create table public.cs_bitacora_pruebas (
  id           bigserial primary key,
  attempt_id   uuid not null references public.card_payment_attempts(id) on delete cascade,
  paso         text not null check (paso in ('capture_context','setup','enroll','validate','pago','captura')),
  metodo       text not null,
  ruta         text not null,
  http_status  integer,
  resultado    text not null,
  request      jsonb,
  response     jsonb,
  duracion_ms  integer not null default 0,
  ambiente     text not null check (ambiente = 'test'),   -- producción NUNCA registra cuerpos
  created_at   timestamptz not null default clock_timestamp()
);
create index idx_csbp_creado on public.cs_bitacora_pruebas (created_at, id);
comment on table public.cs_bitacora_pruebas is
  'CS-BB · bitácora de pruebas para la certificación de BanBajío (casos 3DS 2.1–2.11). Solo sandbox; cuerpos enmascarados por la Edge. '
  'Lectura: Dirección vía cs_bitacora_pruebas_ver. Inserción: service_role.';
alter table public.cs_bitacora_pruebas enable row level security;
revoke all on public.cs_bitacora_pruebas from public, anon, authenticated;
revoke all on sequence public.cs_bitacora_pruebas_id_seq from public, anon, authenticated;
grant select, insert on public.cs_bitacora_pruebas to service_role;
grant usage on sequence public.cs_bitacora_pruebas_id_seq to service_role;

create function public.cs_bitacora_pruebas_contar() returns integer
  language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null or public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  return (select count(*)::int from public.cs_bitacora_pruebas);
end $$;
revoke all on function public.cs_bitacora_pruebas_contar() from public, anon;
grant execute on function public.cs_bitacora_pruebas_contar() to authenticated;

create function public.cs_bitacora_pruebas_ver(p_limite integer default 5000) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null or public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(b) - 'ambiente' order by b.created_at, b.id)
      from (select * from public.cs_bitacora_pruebas order by created_at, id limit greatest(1, least(coalesce(p_limite, 5000), 20000))) b
  ), '[]'::jsonb);
end $$;
comment on function public.cs_bitacora_pruebas_ver(integer) is 'CS-BB · filas de la bitácora de pruebas (Dirección) para exportarlas a CSV y enviarlas a BanBajío.';
revoke all on function public.cs_bitacora_pruebas_ver(integer) from public, anon;
grant execute on function public.cs_bitacora_pruebas_ver(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4) Limpieza en la tarea existente (renovacell-cs-intentos, cada 5 min). Misma expiración de la 184 + borrado 3DS.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.cs_intentos_expirar() returns integer
  language plpgsql security definer set search_path = public as
$$
declare r record; n int := 0;
begin
  for r in select id, status from public.card_payment_attempts
            where status in ('created','tokenized','auth_setup','auth_pending','auth_challenge','auth_validated')
              and status_at < clock_timestamp() - interval '15 minutes'
            for update skip locked loop
    update public.card_payment_attempts set status = 'expired', status_at = clock_timestamp(), updated_at = clock_timestamp() where id = r.id;
    perform public._cs_evento(r.id, r.status, 'expired', jsonb_build_object('motivo', 'inactividad > 15 min antes de enviar al banco'));
    n := n + 1;
  end loop;
  -- CS-BB · los valores 3DS solo sirven antes de enviar la venta: vencidos (1 h) o de intentos ya fuera de la autenticación se borran.
  delete from public.card_payment_3ds_auth d
   where d.expires_at < clock_timestamp()
      or not exists (select 1 from public.card_payment_attempts a
                      where a.id = d.attempt_id and a.status in ('created','tokenized','auth_setup','auth_pending','auth_challenge','auth_validated'));
  return n;
end $$;
revoke all on function public.cs_intentos_expirar() from public, anon, authenticated;

do $post$ begin
  if to_regclass('public.card_payment_3ds_auth') is null or to_regclass('public.cs_bitacora_pruebas') is null then raise exception 'CS-BB: faltan tablas'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('card_payment_3ds_auth','cs_bitacora_pruebas') and not c.relrowsecurity) <> 0 then raise exception 'CS-BB: RLS apagada'; end if;
  if has_table_privilege('authenticated', 'public.card_payment_3ds_auth', 'select') or has_table_privilege('anon', 'public.card_payment_3ds_auth', 'select')
     or has_table_privilege('authenticated', 'public.cs_bitacora_pruebas', 'select') or has_table_privilege('anon', 'public.cs_bitacora_pruebas', 'select') then raise exception 'CS-BB: permisos indebidos'; end if;
  if not exists (select 1 from cron.job where jobname = 'renovacell-cs-intentos') then raise exception 'CS-BB: falta la tarea de expiración/limpieza'; end if;
end $post$;
