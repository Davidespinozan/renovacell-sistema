-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CORREOS AUTOMÁTICOS (migración 165) · SALEN SOLOS, CORREOS DE LA CUENTA Y NADA FUERA DE LUGAR EN MOSTRADOR
--   Decisión del dueño (15 oct 2026, "lo que tú creas más profesional"):
--   · ENVÍO AUTOMÁTICO: cada minuto, si hay correos por enviar, la base llama a la Edge comm-dispatch (pg_net) con un
--     secreto propio (vault 'comm_cron_secret'; la Edge lo compara con CORREOS_CRON_SECRET). Sin secreto configurado no
--     hace nada (falla cerrado). Dirección sigue viendo, reintentando y descartando en "Correos al cliente".
--   · CORREOS DE LA CUENTA (doctor): 'registro_recibido' (cuando ÉL se registra en la landing o el chat), 'cuenta_verificada' (al
--     aprobarlo) y 'verificacion_rechazada' (con el motivo). Una sola vez por hecho (event_key).
--   · MOSTRADOR: un pago de una venta POS ya no manda "Recibimos tu pago… te avisaremos cuando salga" (el cliente ya se
--     llevó el producto).
--   NO cambia: el buzón (reglas de enviado/incierto/reintento), las plantillas de pedido ni quién administra los correos.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/correos_automaticos/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._comm_encolar_cuenta(text,text,uuid,jsonb)') is not null then raise exception 'CORREOS-AUTO: ya aplicada'; end if;
  if md5(pg_get_functiondef('public._comm_tr_payment_entries()'::regprocedure)) <> 'fa1fda3f3721f65f41686c76edfdcd3f' then
    raise exception 'CORREOS-AUTO: _comm_tr_payment_entries no es la versión auditada (W4)';
  end if;
end $pre$;

-- pg_net (llamadas HTTP desde la base). En Supabase está disponible; el entorno de pruebas la emula en el shim.
do $ext$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net with schema extensions; end if;
end $ext$;

-- ── 1 · Plantillas de la cuenta ────────────────────────────────────────────────────────────────────
alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in (
  'pedido_recibido','pago_recibido','pedido_enviado','pedido_entregado','pedido_cancelado','reembolso_realizado',
  'registro_recibido','cuenta_verificada','verificacion_rechazada'));

create function public._comm_encolar_cuenta(p_event_key text, p_plantilla text, p_profile uuid, p_payload jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
-- Como _comm_encolar, pero el destinatario es la CUENTA (no hay pedido). Nunca tumba la operación que lo originó.
declare v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_email text; v_name text;
begin
  select nullif(lower(btrim(coalesce(email, ''))), ''), coalesce(nullif(btrim(full_name), ''), meta ->> 'name') into v_email, v_name
    from public.profiles where id = p_profile;
  perform set_config('app.trusted', 'on', true);
  insert into public.comm_outbox (event_key, plantilla, order_id, customer_id, profile_id, to_address, to_name, payload, status)
  values (p_event_key, p_plantilla, null, null, p_profile, v_email, v_name, coalesce(p_payload, '{}'::jsonb),
          case when v_email is null then 'sin_destinatario' else 'pendiente' end)
  on conflict (event_key) do nothing;
  perform set_config('app.trusted', v_trusted, true);
exception when others then
  perform set_config('app.trusted', v_trusted, true);
  raise warning 'COMM_ENCOLAR_FALLO: % (%)', sqlerrm, p_event_key;
end;
$$;

create function public._comm_tr_cuenta() returns trigger
  language plpgsql security definer set search_path = public as
$$
-- Estados crudos (sin suponer): el registro entra a revisión cuando su estado PASA a 'pending'.
declare v_est text := new.meta -> 'verification' ->> 'status';
        v_ant text := case when tg_op = 'UPDATE' then old.meta -> 'verification' ->> 'status' end;
begin
  if new.role_id is distinct from 'doctor' then return new; end if;
  -- Se registró ÉL (landing o chat) y su cuenta quedó en revisión: una vez por cuenta. Un alta del personal no se anuncia.
  if not new.verified and v_est = 'pending' and v_ant is distinct from 'pending' and new.meta ->> 'capturedVia' in ('auto-registro', 'chat')
     and nullif(btrim(coalesce(new.email, '')), '') is not null then
    perform public._comm_encolar_cuenta('registro_recibido:' || new.id, 'registro_recibido', new.id, '{}'::jsonb);
  end if;
  if tg_op = 'UPDATE' then
    -- Aprobado después de estar en revisión (no una cuenta creada ya verificada, como la de la invitación de Odoo).
    if new.verified and not old.verified and v_ant in ('pending', 'rejected') then
      perform public._comm_encolar_cuenta('cuenta_verificada:' || new.id, 'cuenta_verificada', new.id, '{}'::jsonb);
    elsif v_est = 'rejected' and v_ant is distinct from 'rejected' then
      perform public._comm_encolar_cuenta('verificacion_rechazada:' || new.id || ':' || extract(epoch from now())::bigint, 'verificacion_rechazada', new.id,
        jsonb_build_object('motivo', left(coalesce(new.meta -> 'verification' ->> 'reason', ''), 300)));
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_comm_cuenta after insert or update of verified, meta, email on public.profiles for each row execute function public._comm_tr_cuenta();

-- ── 2 · Mostrador: el pago de una venta POS no se anuncia como "te avisaremos cuando salga" ──────────
CREATE OR REPLACE FUNCTION public._comm_tr_payment_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Una reversa corrige el libro; no es un hecho que se le anuncie al cliente.
  if new.reversal_of is not null or new.order_id is null then return new; end if;
  if new.direction = 'in' then
    -- Venta de mostrador (W1 venta_pos): el cliente ya se llevó el producto; su comprobante es el recibo de caja.
    if exists (select 1 from public.inventory_operations w where w.op_id = new.order_id and w.kind = 'venta_pos') then return new; end if;
    perform public._comm_encolar('pago_recibido:' || new.id, 'pago_recibido', new.order_id,
      jsonb_build_object('monto', new.amount, 'metodo', new.method));
  elsif new.direction = 'out' then
    perform public._comm_encolar('reembolso_realizado:' || new.id, 'reembolso_realizado', new.order_id,
      jsonb_build_object('monto', new.amount, 'metodo', new.method));
  end if;
  return new;
end;
$function$;

-- ── 3 · Envío automático ───────────────────────────────────────────────────────────────────────────
create function public._correos_despachar() returns text
  language plpgsql security definer set search_path = public as
$$
-- Cada minuto: si hay correos por enviar, despierta a la Edge comm-dispatch. Sin URL o sin secreto en vault: nada.
declare v_url text; v_secreto text;
begin
  if not exists (select 1 from public.comm_outbox where status = 'pendiente'
                 or (status = 'incierto' and first_attempt_at > now() - public._comm_ventana_idempotencia())) then
    return 'sin_pendientes';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
  if v_url is null or v_secreto is null then return 'sin_configurar'; end if;
  perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/comm-dispatch',
                        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                        body := '{}'::jsonb, timeout_milliseconds := 30000);
  return 'despachado';
end;
$$;

alter function public._comm_encolar_cuenta(text, text, uuid, jsonb) owner to postgres;
alter function public._comm_tr_cuenta() owner to postgres;
alter function public._correos_despachar() owner to postgres;
revoke all on function public._comm_encolar_cuenta(text, text, uuid, jsonb), public._comm_tr_cuenta(), public._correos_despachar() from public, anon, authenticated;

-- Firma exacta de cron.schedule (job_name, schedule, command): una tarea con nombre, idempotente al reaplicar.
select cron.schedule('renovacell-correos', '* * * * *', 'select public._correos_despachar()');

do $post$ begin
  if md5(pg_get_functiondef('public._comm_tr_payment_entries()'::regprocedure)) = 'fa1fda3f3721f65f41686c76edfdcd3f' then
    raise exception 'CORREOS-AUTO: el pago POS no quedó excluido';
  end if;
  if not exists (select 1 from cron.job where jobname = 'renovacell-correos') then raise exception 'CORREOS-AUTO: falta la tarea programada'; end if;
  if has_function_privilege('authenticated', 'public._correos_despachar()', 'execute') then raise exception 'CORREOS-AUTO: permisos inesperados'; end if;
end $post$;
