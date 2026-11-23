-- Reversa de 20270407810000_gps_obligatorio_entrega.sql.
drop function if exists public.choferes_gps_estado();
drop function if exists public.entrega_sin_ubicacion(uuid, text);
drop function if exists public.chofer_gps_reportar(text);
drop table if exists public.entregas_sin_ubicacion;
drop table if exists public.chofer_gps_estado;
