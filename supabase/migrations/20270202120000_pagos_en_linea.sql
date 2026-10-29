-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PAGOS EN LÍNEA (interruptor de Dirección) · pedido del dueño (28 oct 2026): "un botón en Dirección para deshabilitar los
--   pagos en línea; ya queremos empezar a operar pero aún no estarán los pagos online (falta la info de BanBajío), solo
--   los demás métodos de pago".
--   · pagos_config               una fila: tarjeta_en_linea (APAGADO por omisión), quién y cuándo lo cambió.
--   · pagos_config_hist          bitácora de cada cambio (quién, cuándo, de qué a qué).
--   · pagos_config_ver()         cualquier sesión (el portal decide si ofrece "Tarjeta").
--   · pagos_config_guardar(bool) solo Dirección.
--   · Las Edges que inician un cobro con tarjeta en línea (stripe-checkout, cs-capture-context, cs-pago) lo leen con la
--     llave de servidor y se niegan si está apagado (falla cerrado).
--   NO cambia: transferencia, efectivo, tarjeta en sucursal (Caja), crédito ni contra pedido.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.pagos_config') is not null then raise exception 'PAGOS-EN-LINEA: ya aplicada'; end if;
end $pre$;

create table public.pagos_config (
  id smallint primary key default 1 check (id = 1),
  tarjeta_en_linea boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
insert into public.pagos_config (id, tarjeta_en_linea) values (1, false);
create table public.pagos_config_hist (
  id bigint generated always as identity primary key,
  tarjeta_antes boolean not null,
  tarjeta_despues boolean not null,
  actor uuid references auth.users (id),
  at timestamptz not null default now()
);
alter table public.pagos_config enable row level security;
alter table public.pagos_config_hist enable row level security;
revoke all on public.pagos_config, public.pagos_config_hist from public, anon, authenticated;
grant select on public.pagos_config, public.pagos_config_hist to service_role;

create function public.pagos_config_ver() returns jsonb
  language sql stable security definer set search_path = public as
$$
  select jsonb_build_object('tarjeta_en_linea', c.tarjeta_en_linea, 'updated_at', c.updated_at)
    from public.pagos_config c where c.id = 1 and auth.uid() is not null
$$;

create function public.pagos_config_guardar(p_tarjeta_en_linea boolean) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_antes boolean;
begin
  if auth.uid() is null or public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección activa o apaga los pagos en línea' using errcode = 'insufficient_privilege'; end if;
  if p_tarjeta_en_linea is null then raise exception 'VALOR_INVALIDO' using errcode = 'check_violation'; end if;
  select tarjeta_en_linea into v_antes from public.pagos_config where id = 1 for update;
  if v_antes is distinct from p_tarjeta_en_linea then
    update public.pagos_config set tarjeta_en_linea = p_tarjeta_en_linea, updated_at = now(), updated_by = auth.uid() where id = 1;
    insert into public.pagos_config_hist (tarjeta_antes, tarjeta_despues, actor) values (v_antes, p_tarjeta_en_linea, auth.uid());
  end if;
  return public.pagos_config_ver();
end;
$$;

alter table public.pagos_config owner to postgres;
alter table public.pagos_config_hist owner to postgres;
alter function public.pagos_config_ver() owner to postgres;
alter function public.pagos_config_guardar(boolean) owner to postgres;
revoke all on function public.pagos_config_ver(), public.pagos_config_guardar(boolean) from public, anon;
grant execute on function public.pagos_config_ver(), public.pagos_config_guardar(boolean) to authenticated;
comment on table public.pagos_config is 'Interruptor de Dirección de los pagos con tarjeta en línea (portal). Apagado por omisión.';

do $post$ begin
  if (select tarjeta_en_linea from public.pagos_config where id = 1) then raise exception 'PAGOS-EN-LINEA: debe nacer apagado'; end if;
  if has_table_privilege('authenticated', 'public.pagos_config', 'select') or has_function_privilege('anon', 'public.pagos_config_ver()', 'execute') then raise exception 'PAGOS-EN-LINEA: permisos inesperados'; end if;
end $post$;
