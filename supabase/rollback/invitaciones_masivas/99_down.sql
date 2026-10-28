-- INVITA-1 · rollback de las invitaciones masivas. Aplicar en UNA transacción. Las invitaciones ya emitidas y las cuentas
-- creadas con ellas se conservan (viven en cliente_invitaciones / customers): solo se retira el envío masivo.
do $pre$ begin
  if to_regclass('public.invitacion_campanas') is null then raise exception 'INVITA-1 rollback: la migración no está aplicada'; end if;
end $pre$;
select cron.unschedule('renovacell-invitaciones') where exists (select 1 from cron.job where jobname = 'renovacell-invitaciones');
drop function public._invm_despachar();
drop function public._invm_resolver(bigint, text, text, text);
drop function public._invm_reclamar(text, integer);
drop function public.invitaciones_masivas_revisar(uuid);
drop function public.invitaciones_masivas_estado();
drop function public.invitaciones_masivas_cambiar(uuid, text);
drop function public.invitaciones_masivas_crear(text, uuid, boolean, integer, text, text);
drop function public.invitaciones_masivas_previa(text, uuid, boolean);
drop function public._invm_audiencia(text, uuid, boolean);
drop table public.invitacion_envios;
drop table public.invitacion_campanas;
