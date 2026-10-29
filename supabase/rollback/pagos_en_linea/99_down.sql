-- PAGOS EN LÍNEA · rollback: retira el interruptor (las Edges, sin la tabla, fallan cerrado: sin pagos en línea).
drop function if exists public.pagos_config_guardar(boolean);
drop function if exists public.pagos_config_ver();
drop table if exists public.pagos_config_hist;
drop table if exists public.pagos_config;
