drop function if exists public.cliente_entrega_preferida_guardar(uuid, text);
drop function if exists public.cliente_entrega_preferida(uuid);
alter table public.customers drop column if exists entrega_preferida;
