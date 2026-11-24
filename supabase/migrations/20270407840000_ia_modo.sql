-- ============================================================================
-- IA-MODO (24 nov 2026, dueño): interruptor de Dirección para la autonomía del agente de IA.
--   'completo'  = como hasta hoy: cotiza, arma carrito, cierra pedidos (WhatsApp con vínculo), da seguimiento.
--   'recepcion' = recibe y reconoce al cliente con amabilidad, entiende qué necesita y lo deja listo para su
--                 asesor humano: sin precios, cotizaciones, carrito ni pedidos; cada conversación que atiende pasa
--                 a un asesor (las Edges leen cc_ia_config.modo en cada turno) y el seguimiento proactivo solo
--                 avisa al vendedor, ya no le escribe al cliente.
-- Solo Dirección lo cambia (ia_modo_guardar) y queda en la bitácora.
-- ============================================================================
alter table public.cc_ia_config add column if not exists modo text not null default 'completo';
alter table public.cc_ia_config add column if not exists modo_por uuid;
alter table public.cc_ia_config add column if not exists modo_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_cc_ia_config_modo') then
    alter table public.cc_ia_config add constraint ck_cc_ia_config_modo check (modo in ('completo', 'recepcion'));
  end if;
end $$;

create or replace function public.ia_config() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc_exige_admin();
  return (select jsonb_build_object('modelo_portal', c.modelo_portal, 'esfuerzo_portal', c.esfuerzo_portal, 'updated_at', c.updated_at,
    'modelos', jsonb_build_array('claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'),
    'modo', c.modo, 'modo_at', c.modo_at,
    'modo_por', (select coalesce(nullif(p.meta ->> 'name', ''), p.full_name, p.email) from public.profiles p where p.id = c.modo_por))
    from public.cc_ia_config c where c.id);
end;
$$;

create or replace function public.ia_modo_guardar(p_modo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_antes text;
begin
  perform public._cc_exige_admin();
  if p_modo is null or p_modo not in ('completo', 'recepcion') then
    raise exception 'MODO_INVALIDO: completo o recepcion' using errcode = 'check_violation';
  end if;
  select modo into v_antes from public.cc_ia_config where id for update;
  if v_antes is distinct from p_modo then
    update public.cc_ia_config set modo = p_modo, modo_por = auth.uid(), modo_at = now() where id;
    perform public.log_audit('Asistente IA', 'modo',
      case p_modo when 'recepcion' then 'Solo recepción: recibe al cliente y lo pasa a su asesor' else 'Venta completa: atiende y vende de punta a punta' end, 'Dirección');
  end if;
  return public.ia_config();
end;
$$;

revoke all on function public.ia_modo_guardar(text) from public, anon;
grant execute on function public.ia_modo_guardar(text) to authenticated;

-- Seguimiento proactivo: en recepción NO se le escribe al cliente; el vendedor recibe el aviso como cuando un asesor lo atiende.
do $$
declare d text := pg_get_functiondef('public.cc_seguimiento_despachar()'::regprocedure);
  a1 text := 'n int := 0; v_que text;';
  b1 text := 'n int := 0; v_que text; v_recepcion boolean := coalesce((select modo = ''recepcion'' from public.cc_ia_config where id), false);';
  a2 text := 'if v_puede in (''asesor'', ''activo'') then';
  b2 text := 'if v_puede in (''asesor'', ''activo'') or v_recepcion then';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'IA_MODO: cc_seguimiento_despachar cambió; revisar el parche';
  end if;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;
