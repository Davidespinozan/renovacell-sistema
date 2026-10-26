-- R4-C5-A2 · ALTA del contacto de prueba y entrada al modo prueba con la IA APAGADA (etapa 1). Una transacción.
-- Requiere la migración 20270123120000 aplicada y autorización expresa. Se ejecuta como postgres (Management API).
-- Parámetros fijos y verificados aquí mismo: contacto = el ÚNICO wa_id que termina en 3464; vence en 60 minutos;
-- autoriza el perfil de Dirección indicado (uuid). Si algo no cuadra, aborta sin cambiar nada.
begin;
do $alta$
declare v_wa text; v_n int; v_admin uuid := '00000000-0000-0000-0000-000000000000';   -- ← REEMPLAZAR por el uuid del perfil de Dirección que autoriza
begin
  select count(*), min(wa_id) into v_n, v_wa from public.cc_wa_contactos where right(wa_id, 4) = '3464';
  if v_n <> 1 then raise exception 'ALTO: se esperaba exactamente un contacto terminado en 3464 (hay %)', v_n; end if;
  if (select profile_id from public.cc_wa_contactos where wa_id = v_wa) is not null then raise exception 'ALTO: el contacto está vinculado a una cuenta (R4-B1)'; end if;
  if (select role_id from public.profiles where id = v_admin and active) is distinct from 'admin' then raise exception 'ALTO: el perfil que autoriza no es Dirección activa'; end if;
  if (select modo from public.cc_wa_config where id) <> 'espejo' then raise exception 'ALTO: WhatsApp no está en espejo'; end if;
  if exists (select 1 from public.cc_wa_salida where estado in ('pendiente', 'enviando')) then raise exception 'ALTO: hay salidas pendientes o en curso'; end if;
  insert into public.cc_canal_prueba (canal, contacto, autorizado_por, motivo, vence_at)
  values ('whatsapp', v_wa, v_admin, 'Primera prueba controlada R4-C5 (…3464)', now() + interval '60 minutes');
  update public.cc_wa_config set modo = 'prueba', ia_habilitada = false where id;   -- etapa 1: IA apagada
end $alta$;
select jsonb_build_object('modo', (select modo from public.cc_wa_config where id), 'ia', (select ia_habilitada from public.cc_wa_config where id),
  'vigentes', (select jsonb_agg(jsonb_build_object('contacto', '…' || right(contacto, 4), 'vence_at', vence_at)) from public.cc_canal_prueba where revocado_at is null and vence_at > now())) as alta;
commit;
-- Etapa 2 (con autorización aparte): update public.cc_wa_config set ia_habilitada = true where id;
-- Cierre: supabase/ops/r4c5_prueba_cierre.sql
