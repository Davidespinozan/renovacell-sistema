-- R4-B2-1 · ROLLBACK: retira los controles por canal (columnas ia_habilitada/envio_pausado, historial, triggers, compuerta y RPC).
-- Los modos (espejo/activo) se conservan tal cual. Se pierde el historial de cambios de controles.
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop function if exists public.cc_canal_cambiar(text, jsonb, text);
drop function if exists public.cc_canal_estado();
drop trigger if exists trg_cc_wa_config_auditar on public.cc_wa_config;
drop trigger if exists trg_cc_wa_config_normalizar on public.cc_wa_config;
drop trigger if exists trg_cc_meta_config_auditar on public.cc_meta_config;
drop trigger if exists trg_cc_meta_config_normalizar on public.cc_meta_config;
drop function if exists public._cc_canal_control_auditar();
drop function if exists public._cc_canal_control_normalizar();
drop function if exists public._cc_canal_activacion_lista();
drop table if exists public.cc_canal_control_hist;
alter table public.cc_wa_config drop constraint if exists ck_wa_ia_requiere_activo, drop column if exists ia_habilitada, drop column if exists envio_pausado;
alter table public.cc_meta_config drop constraint if exists ck_meta_ia_requiere_activo, drop column if exists ia_habilitada, drop column if exists envio_pausado;
