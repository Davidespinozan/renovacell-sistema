-- Reversa de 20270403120000_wa_plantillas.sql.
do $patch$
declare d text := pg_get_functiondef('public._cc_wa_encolar()'::regprocedure);
begin
  d := replace(d, 'v_estado := case when coalesce(new.client_message_id, '''') not like ''tpl:%'' and (not (k.ultimo_entrante_at > now() - interval ''24 hours'') or k.ultimo_entrante_at is null) then ''fuera_ventana''',
                  'v_estado := case when not (k.ultimo_entrante_at > now() - interval ''24 hours'') or k.ultimo_entrante_at is null then ''fuera_ventana''');
  execute d;
end $patch$;
drop function if exists public.cc_wa_plantilla_enviar(uuid, text, uuid, text), public.cc_wa_plantilla_activar(text, boolean), public.cc_wa_plantillas_lista();
drop trigger if exists cc_wa_baja_promo on public.cc_messages;
drop function if exists public._cc_wa_baja_promo_tr();
drop table if exists public.cc_wa_bajas_promo;
drop table if exists public.cc_wa_plantilla_envios;
drop table if exists public.cc_wa_plantillas;
