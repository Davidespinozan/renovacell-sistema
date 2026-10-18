-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CORREO DE PRUEBA DE UNA PROMOCIÓN (migración 178) · PROMO-7: Dirección o Facturación se mandan el correo REAL de la
--   promoción a la dirección que escriban (p. ej. la suya) antes de enviarlo a los doctores. Sale por el mismo buzón
--   (comm_outbox, plantilla 'promocion'); no cuenta como envío a doctores ni toca promocion_envios.
--   Dueño (18 oct 2026): "¿podemos mandar un ejemplo a mi correo?".
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.promo_tarjeta(uuid)') is null then raise exception 'PROMO-PRUEBA: falta la 177'; end if;
  if to_regprocedure('public.promocion_prueba_correo(uuid,text)') is not null then raise exception 'PROMO-PRUEBA: ya aplicada'; end if;
end $pre$;

create function public.promocion_prueba_correo(p_id uuid, p_email text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare tx jsonb; v_email text := lower(btrim(coalesce(p_email, ''))); v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_key text; v_nombre text;
begin
  if not public._promo_puede_administrar() then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación mandan promociones' using errcode = 'insufficient_privilege'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'CORREO_INVALIDO: escribe un correo válido' using errcode = 'check_violation'; end if;
  tx := public._promo_texto(p_id);
  if tx is null then raise exception 'PROMO_INEXISTENTE' using errcode = 'check_violation'; end if;
  -- Máximo 5 pruebas por promoción cada 10 minutos (es una prueba, no una campaña).
  if (select count(*) from public.comm_outbox o where o.plantilla = 'promocion' and o.event_key like 'promo-prueba:' || p_id::text || ':%' and o.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'PRUEBAS_EXCEDIDAS: espera unos minutos antes de mandar otra prueba' using errcode = 'check_violation';
  end if;
  select coalesce(nullif(btrim(full_name), ''), meta ->> 'name') into v_nombre from public.profiles where id = auth.uid();
  v_key := 'promo-prueba:' || p_id::text || ':' || md5(v_email || clock_timestamp()::text);
  perform set_config('app.trusted', 'on', true);
  insert into public.comm_outbox (event_key, plantilla, profile_id, to_address, to_name, payload, status)
  values (v_key, 'promocion', auth.uid(), v_email, v_nombre, tx || jsonb_build_object('promocion_id', p_id, 'prueba', true), 'pendiente');
  perform set_config('app.trusted', v_trusted, true);
  perform public.log_audit('Promoción: correo de prueba', tx ->> 'nombre', 'a ' || v_email, case when public.auth_role() = 'admin' then 'Dirección' else 'Facturación' end);
  return jsonb_build_object('encolado', true, 'para', v_email, 'asunto', (tx ->> 'nombre') || ' · ' || (tx ->> 'vigencia'));
end;
$$;
alter function public.promocion_prueba_correo(uuid, text) owner to postgres;
revoke all on function public.promocion_prueba_correo(uuid, text) from public, anon;
grant execute on function public.promocion_prueba_correo(uuid, text) to authenticated;
