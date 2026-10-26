-- R4-B2-3b · ROLLBACK: retira la exclusividad de escritura en canales, el filtro de IA en la salida y la toma de Dirección.
-- Las conversaciones tomadas siguen en human_active (sin la marca tomada_por); historial y eventos se conservan.
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop function if exists public.cc_tomar_conversacion(uuid, text);
drop trigger if exists trg_cc_wa_salida_filtrar_ia on public.cc_wa_salida;
drop trigger if exists trg_cc_meta_salida_filtrar_ia on public.cc_meta_salida;
drop trigger if exists trg_ccm_exclusividad_canal on public.cc_messages;
drop trigger if exists trg_ccc_toma_limpiar on public.cc_conversations;
drop function if exists public._cc_salida_filtrar_ia();
drop function if exists public._cc_exclusividad_canal();
drop function if exists public._cc_conv_toma_limpiar();
alter table public.cc_conversations drop column if exists tomada_at, drop column if exists tomada_por;
