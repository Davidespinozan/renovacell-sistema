-- AVISO DE VERIFICACIÓN · rollback de la migración 163. Las carteras asignadas y los avisos ya enviados se quedan.
drop function public.mis_por_verificar();
drop function public.verificacion_avisar(uuid);
drop function public._vendedor_de_doctor(uuid);
