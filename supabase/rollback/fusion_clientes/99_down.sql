-- FUSIÓN (0762) · down: sin herramienta de repetidos (las fichas ya fusionadas siguen archivadas, con su rastro en meta).
drop function if exists public.clientes_marcar_distintos(uuid[]);
drop function if exists public.clientes_fusionar(uuid, uuid[], text);
drop function if exists public._cliente_fusionar_uno(uuid, uuid, text);
drop function if exists public.clientes_duplicados(integer);
drop table if exists public.clientes_no_duplicados;
drop table if exists public.clientes_fusiones;
