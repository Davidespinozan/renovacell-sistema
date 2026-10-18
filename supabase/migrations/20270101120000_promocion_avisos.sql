-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- AVISOS DE UNA PROMOCIÓN (migración 179) · PROMO-8: cuando una promoción se manda por el chat, se avisa (push) a los
--   doctores que tengan avisos activados, una sola vez por doctor. El envío lo hace la Edge `push` (acción 'promo'); aquí
--   viven la lista de pendientes y la marca de avisado.
--   Dueño (18 oct 2026): "le piqué enviar por chat … se envió sin hacer ninguna notificación al doctor".
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.promocion_prueba_correo(uuid,text)') is null then raise exception 'PROMO-AVISOS: falta la 178'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'promocion_envios' and column_name = 'avisado_at') then raise exception 'PROMO-AVISOS: ya aplicada'; end if;
end $pre$;

alter table public.promocion_envios add column avisado_at timestamptz;

-- Doctores con el mensaje de chat entregado y sin aviso todavía (solo el servidor).
create function public.promocion_avisos_pendientes(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare p public.promociones%rowtype;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into p from public.promociones where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object('nombre', p.nombre, 'vigencia', public._promo_texto(p_id) ->> 'vigencia', 'vigente', p.activa and public._promo_hoy() between p.desde and p.hasta,
    'perfiles', coalesce((select jsonb_agg(e.profile_id) from public.promocion_envios e where e.promocion_id = p_id and e.canal = 'chat' and e.estado = 'entregado' and e.avisado_at is null), '[]'::jsonb));
end;
$$;

create function public.promocion_avisos_marcar(p_id uuid, p_profiles uuid[]) returns int
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.promocion_envios set avisado_at = now() where promocion_id = p_id and canal = 'chat' and estado = 'entregado' and avisado_at is null and profile_id = any (coalesce(p_profiles, '{}'));
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public._promo_json(p_id uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'desde', p.desde, 'hasta', p.hasta, 'activa', p.activa, 'listas', p.listas,
           'estado', case when not p.activa then 'inactiva' when public._promo_hoy() < p.desde then 'proxima' when public._promo_hoy() > p.hasta then 'vencida' else 'vigente' end,
           'lineas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'product_id', l.product_id, 'producto', pr.name, 'precio_normal', pr.price, 'min_qty', l.min_qty, 'precio', l.precio) order by pr.name, l.min_qty)
                                from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p.id), '[]'::jsonb),
           'ventas', public._promo_ventas(p.id),
           'difusion', (select jsonb_build_object('correo', count(*) filter (where e.canal = 'correo' and e.estado = 'encolado'), 'chat', count(*) filter (where e.canal = 'chat' and e.estado = 'entregado'),
                                                  'sin_correo', count(*) filter (where e.estado = 'sin_correo'), 'avisados', count(*) filter (where e.canal = 'chat' and e.avisado_at is not null),
                                                  'sin_avisar', count(*) filter (where e.canal = 'chat' and e.estado = 'entregado' and e.avisado_at is null), 'ultimo', max(e.created_at)) from public.promocion_envios e where e.promocion_id = p.id),
           'updated_at', p.updated_at)
    from public.promociones p where p.id = p_id
$$;

alter function public.promocion_avisos_pendientes(uuid) owner to postgres;
alter function public.promocion_avisos_marcar(uuid, uuid[]) owner to postgres;
revoke all on function public.promocion_avisos_pendientes(uuid), public.promocion_avisos_marcar(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.promocion_avisos_pendientes(uuid), public.promocion_avisos_marcar(uuid, uuid[]) to service_role;
