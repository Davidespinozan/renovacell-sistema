-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ELIMINAR PROMOCIÓN (migración 176) · PROMO-5: una promoción que nunca se envió ni vendió se puede borrar (p. ej. una capturada
--   dos veces, como pasó el 18 oct 2026). Si ya se envió o ya vendió, no se borra: se pausa (queda su historia).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.promocion_envios') is null then raise exception 'PROMO-ELIMINAR: falta la 175'; end if;
  if to_regprocedure('public.promocion_eliminar(uuid)') is not null then raise exception 'PROMO-ELIMINAR: ya aplicada'; end if;
end $pre$;

create function public.promocion_eliminar(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_nombre text; v_vendido int;
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación administran promociones' using errcode = 'insufficient_privilege'; end if;
  select nombre into v_nombre from public.promociones where id = p_id for update;
  if not found then raise exception 'PROMO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.promocion_envios e where e.promocion_id = p_id and e.estado in ('encolado', 'entregado')) then
    raise exception 'PROMO_CON_ENVIOS: esta promoción ya se mandó a doctores; pásala a pausada en lugar de borrarla' using errcode = 'check_violation';
  end if;
  v_vendido := (public._promo_ventas(p_id) ->> 'pedidos')::int;
  if v_vendido > 0 then raise exception 'PROMO_CON_VENTAS: esta promoción ya tiene pedidos; pásala a pausada en lugar de borrarla' using errcode = 'check_violation'; end if;
  delete from public.promociones where id = p_id;   -- renglones y registros de envío fallidos caen en cascada
  perform public.log_audit('Promoción eliminada', v_nombre, null, case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return jsonb_build_object('eliminada', true, 'nombre', v_nombre);
end;
$$;
alter function public.promocion_eliminar(uuid) owner to postgres;
revoke all on function public.promocion_eliminar(uuid) from public, anon;
grant execute on function public.promocion_eliminar(uuid) to authenticated;
