-- AVISO RUIDOSO (20270305) · down: sin push de alertas ni aviso de "tu cliente está escribiendo".
drop trigger if exists cc_aviso_push on public.notifications;
drop trigger if exists trg_ccm_zzescribe on public.cc_messages;
drop function if exists public._cc_aviso_push_tr();
drop function if exists public.aviso_push_carga(uuid);
drop function if exists public._cc_cliente_escribe_tr();
drop function if exists public._cc_responsable_comercial(uuid);
