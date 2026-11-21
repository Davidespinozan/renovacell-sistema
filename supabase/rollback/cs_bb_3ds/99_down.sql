-- CS-BB (20270407410000) · rollback: retira los datos 3DS de corta vida, la bitácora de pruebas, el id del procesador y devuelve
-- cs_intentos_expirar EXACTAMENTE a la definición de la 184. Los intentos conservan su estado y su bitácora de eventos.
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop function if exists public.cs_bitacora_pruebas_ver(integer);
drop function if exists public.cs_bitacora_pruebas_contar();
drop function if exists public.cs_intento_procesador(uuid, text);
drop table if exists public.cs_bitacora_pruebas;
drop table if exists public.card_payment_3ds_auth;
alter table public.card_payment_attempts drop column if exists cs_processor_transaction_id;
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
  return n;
end $$;
revoke all on function public.cs_intentos_expirar() from public, anon, authenticated;
