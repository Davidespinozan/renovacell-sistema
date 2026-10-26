-- R4-C5-A2 · CIERRE INMEDIATO DEL MODO PRUEBA (WhatsApp). Una transacción, idempotente, sin borrar nada.
-- Efecto: canal a espejo (la IA se apaga en el mismo cambio), lo pendiente queda RETENIDO, los permisos vigentes quedan
-- REVOCADOS (se conservan en cc_canal_prueba y el cambio queda en cc_canal_control_hist con origen 'directo').
-- Un POST que ya pasó el último chequeo (≤ 15 s) no se puede cancelar: ese único envío puede llegar.
-- Probado en supabase/tests/db/tests/canal_05_prueba.sql §10–§11.
begin;
update public.cc_wa_config set modo = 'espejo', ia_habilitada = false where id and (modo <> 'espejo' or ia_habilitada);
update public.cc_canal_prueba set revocado_at = now(), revocado_motivo = 'cierre inmediato (r4c5_prueba_cierre.sql)'
 where canal = 'whatsapp' and revocado_at is null;   -- por si alguno quedó vigente (el trigger de cierre ya los revoca)
select jsonb_build_object(
  'modo', (select modo from public.cc_wa_config where id), 'ia', (select ia_habilitada from public.cc_wa_config where id),
  'permisos_vigentes', (select count(*) from public.cc_canal_prueba where revocado_at is null and vence_at > now()),
  'por_salir', (select count(*) from public.cc_wa_salida where estado in ('pendiente', 'enviando')),
  'retenidos', (select count(*) from public.cc_wa_salida where estado = 'retenido')) as cierre;   -- esperado: espejo, false, 0, 0
commit;
