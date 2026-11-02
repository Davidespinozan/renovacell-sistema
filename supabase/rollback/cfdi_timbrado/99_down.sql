-- Reversa de 20270310120000_cfdi_timbrado.sql: quita el concepto fiscal del envío y la preparación del timbrado.
drop function if exists public.cfdi_preparar(uuid);
drop function if exists public.fiscal_envio_validar(text);
drop function if exists public.fiscal_envio_guardar(jsonb);
drop function if exists public.fiscal_envio_ver();
drop table if exists public.fiscal_concepto_envio;
drop function if exists public.fiscal_concepto_envio_guard();
