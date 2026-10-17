-- EMPAQUES · rollback de la migración 172: se retira el catálogo y sus funciones. No toca pedidos ni guías.
drop function public.empaque_guardar(jsonb);
drop function public.empaques_lista(boolean);
drop table public.empaques;
