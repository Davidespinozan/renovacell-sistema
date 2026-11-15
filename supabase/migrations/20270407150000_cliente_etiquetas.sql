-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ETIQUETAS EN LA FICHA DEL CLIENTE (15 nov 2026, equipo: "etiquetas para los clientes"). Las etiquetas de cada vendedora
-- ya existen: son sus LISTAS de Difusiones (cc_etiquetas + cc_etiqueta_clientes). Esta función dice cuáles de SUS
-- etiquetas tiene un cliente, para verlas y ponerlas o quitarlas desde su ficha (lista_guardar y lista_clientes_cambiar ya
-- existen y conservan sus reglas: solo clientes de su alcance).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cliente_etiquetas(uuid)') is not null then raise exception 'CLIENTE-ETIQUETAS: ya aplicada'; end if;
  if to_regprocedure('public._dif_alcance()') is null then raise exception 'CLIENTE-ETIQUETAS: faltan Difusiones'; end if;
end $pre$;

create function public.cliente_etiquetas(p_customer uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._dif_alcance();
  if not public._dif_es_mio(p_customer, a.todos, a.uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre,
            'puesta', exists (select 1 from public.cc_etiqueta_clientes ec where ec.etiqueta_id = e.id and ec.customer_id = p_customer)) order by e.nombre)
    from public.cc_etiquetas e where e.seller_profile_id = a.uid), '[]'::jsonb);
end;
$$;
revoke all on function public.cliente_etiquetas(uuid) from public, anon;
grant execute on function public.cliente_etiquetas(uuid) to authenticated;
