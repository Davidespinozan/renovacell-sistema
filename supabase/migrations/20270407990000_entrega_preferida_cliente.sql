-- ============================================================================
-- ENTREGA PREFERIDA POR CLIENTE (26 nov 2026, dueño/Toño: «que se le pueda configurar a cada cliente sus preferencias
-- de paquetería; hay clientes que ya la tienen preestablecida y no quieren que les estén preguntando cada pedido»).
--   · customers.entrega_preferida = id de la opción de entrega (foraneo_estafeta, foraneo_dhl, local_chofer, recoge…).
--   · Levantar pedido la elige sola si está disponible; si no aplica (otra ciudad, sin cobertura) usa la sugerida.
--   · La guardan Dirección, Facturación o Ventas desde el mismo pedido («Usar siempre esta entrega para el cliente»).
-- Rollback: supabase/rollback/entrega_preferida/99_down.sql
-- ============================================================================
alter table public.customers add column entrega_preferida text;
alter table public.customers add constraint ck_customers_entrega_preferida check (entrega_preferida is null or entrega_preferida ~ '^[a-z_]{3,40}$');
comment on column public.customers.entrega_preferida is 'Opción de entrega que se preselecciona al levantarle un pedido (id de entrega_opciones)';

create function public.cliente_entrega_preferida(p_customer uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select c.entrega_preferida from public.customers c
   where c.id = p_customer and public.auth_role() in ('admin', 'billing', 'pos');
$function$;

create function public.cliente_entrega_preferida_guardar(p_customer uuid, p_opcion text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_op text := nullif(btrim(coalesce(p_opcion, '')), '');
begin
  if auth.uid() is null or public.auth_role() not in ('admin', 'billing', 'pos') then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_op is not null and v_op !~ '^[a-z_]{3,40}$' then raise exception 'OPCION_INVALIDA' using errcode = 'check_violation'; end if;
  update public.customers set entrega_preferida = v_op, updated_at = now() where id = p_customer;
  if not found then raise exception 'CLIENTE_INEXISTENTE'; end if;
  return v_op;
end;
$function$;
revoke all on function public.cliente_entrega_preferida(uuid) from public, anon;
revoke all on function public.cliente_entrega_preferida_guardar(uuid, text) from public, anon;
grant execute on function public.cliente_entrega_preferida(uuid) to authenticated, service_role;
grant execute on function public.cliente_entrega_preferida_guardar(uuid, text) to authenticated, service_role;
