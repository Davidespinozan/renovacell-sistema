-- ALTA-DESDE-CONVERSACIÓN (20270208) · down: se retiran los dos comandos (las fichas y fotos ya registradas se conservan).
drop function if exists public.cc_alta_cliente_conversacion(uuid, text, text, text, text, uuid, uuid);
drop function if exists public.cc_adjunto_registrar_wa(uuid, text, text, integer);
