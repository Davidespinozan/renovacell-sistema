-- RETOMA DEL ASESOR (20270304) · down: sin retoma ni preferencia por el último asesor.
drop trigger if exists trg_ccm_zretoma on public.cc_messages;
drop trigger if exists cc_preferir_ultimo_asesor on public.cc_conversations;
drop trigger if exists cc_ultimo_asesor on public.cc_conversation_events;
drop function if exists public._cc_retoma_tr();
drop function if exists public._cc_preferir_ultimo_asesor_tr();
drop function if exists public._cc_ultimo_asesor_tr();
alter table public.cc_conversations drop column if exists ultimo_asesor_at, drop column if exists ultimo_asesor_id;
