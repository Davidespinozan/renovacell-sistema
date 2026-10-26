-- R4-B2-4 · ROLLBACK: retira las dos lecturas del panel operativo de canales. No hay datos que conservar (solo lectura).
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop function if exists public.cc_canal_panel(text);
drop function if exists public.cc_canal_conversacion_control(uuid);
drop function if exists public._cc_nombre_personal(uuid);
