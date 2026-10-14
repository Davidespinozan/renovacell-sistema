-- CAPTURAR CÉDULA · rollback de la migración 158. Las cédulas ya capturadas se conservan.
drop function public.doctor_capturar_cedula(uuid, text);
