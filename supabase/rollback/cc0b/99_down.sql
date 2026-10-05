-- ============================================================================
-- CC-0B · ROLLBACK. Retira el limitador, el dedupe indexado y la retirada de privilegios
-- por defecto para anon (vuelven a concederse, como estaban).
--
-- NO vuelve a conceder los privilegios retirados sobre vistas/tablas (escritura por vistas,
-- anon sobre 36 tablas, TRUNCATE/REFERENCES/TRIGGER, escrituras sin política): eran
-- privilegios por defecto sin ningún consumidor y uno de ellos es un P0 activo. Reabrirlos
-- no es un "estado anterior" que valga la pena restaurar.
--
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
drop function if exists public.rate_limit_hit(text, text, int, int, int);
drop table if exists public.rate_limit_buckets;
drop function if exists public.buscar_prospecto_duplicado(text, text);
drop index if exists public.idx_prospects_email_lower;
drop index if exists public.idx_prospects_phone_digits;

alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant all on functions to anon;
