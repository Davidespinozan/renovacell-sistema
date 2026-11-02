-- WA VÍNCULO (20270302) · down: sin vínculos explícitos (la IA vuelve a tratar todo WhatsApp como público).
drop function if exists public.wa_vinculo_personal(uuid, uuid);
drop function if exists public.cc_ia_identidad_canal(uuid);
drop function if exists public.cc_wa_vincular(text, text, uuid);
drop function if exists public._cc_wa_aviso(uuid, text, text);
drop function if exists public.wa_vinculo_quitar();
drop function if exists public.wa_vinculo_estado();
drop function if exists public.wa_vinculo_codigo();
drop table if exists public.cc_wa_codigos;
alter table public.cc_wa_config drop column if exists numero_publico;
alter table public.cc_wa_contactos drop column if exists vinculado_por, drop column if exists vinculado_via, drop column if exists vinculado_at, drop column if exists vinculo_profile_id;
