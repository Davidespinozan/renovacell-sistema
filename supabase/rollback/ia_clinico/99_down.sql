-- IA CLÍNICA (20270227) · down: cc_ia_contexto_actor vuelve a la definición de CC-4 (sin 'clinico').
create or replace function public.cc_ia_contexto_actor(p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare p record;
begin
  perform public._cc_solo_servicio();
  if p_profile is null then
    return jsonb_build_object('actor', 'visitor', 'audiencia', 'public', 'puede_precio', false, 'puede_stock', false, 'puede_pedidos', false, 'verificado', false, 'rol', '');
  end if;
  select role_id, active, verified, price_list_id into p from public.profiles where id = p_profile;
  if not found or not coalesce(p.active, false) then
    return jsonb_build_object('actor', 'suspendido', 'audiencia', 'public', 'puede_precio', false, 'puede_stock', false, 'puede_pedidos', false, 'verificado', false, 'rol', coalesce(p.role_id, ''));
  end if;
  return jsonb_build_object(
    'actor', case when p.role_id = 'doctor' then 'doctor' when p.role_id = 'admin' then 'admin' else 'staff' end,
    'audiencia', case when p.role_id = 'admin' then 'staff' when p.role_id = 'doctor' then case when p.verified then 'verified' else 'public' end else 'verified' end,
    'puede_precio', coalesce(p.role_id, '') <> '' and (p.role_id <> 'doctor' or coalesce(p.verified, false)),   -- = puede_ver_precio() para ese perfil
    'puede_stock',  coalesce(p.role_id, '') <> '' and (p.role_id <> 'doctor' or coalesce(p.verified, false)),
    'puede_pedidos', p.role_id = 'doctor',
    'verificado', coalesce(p.verified, false), 'rol', coalesce(p.role_id, ''));
end;
$$;
