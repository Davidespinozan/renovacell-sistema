-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- VERIFICARME EN EL CHAT (migración 159) · QUIEN ENTRÓ POR EL ENLACE CREA SU CUENTA SIN SALIR DE LA CONVERSACIÓN
--   Decisión del dueño (15 oct 2026): el doctor se verifica en el mismo chat. Nombre, celular y correo ya los dejó en
--   su prerregistro; en el chat solo da su cédula, las fotos del INE y una contraseña. La Edge `visitor` crea la cuenta
--   (pendiente: la aprobación sigue siendo de una persona) y la liga a su visitante, así la conversación continúa.
--   · cc_prerregistro_datos(hash)   NUEVA (servidor). Los datos del prerregistro de ESE visitante (para no volver a
--                                    pedirlos y para crear la cuenta con el mismo correo). Nunca de otro visitante.
--   NO cambia: el prerregistro, la puerta del chat, la aprobación ni el registro de la landing.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/verificarme_en_chat/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_prerregistro_datos(text)') is not null then raise exception 'VERIFICARME: ya aplicada'; end if;
  if to_regclass('public.cc_prerregistros') is null then raise exception 'VERIFICARME: falta la 150'; end if;
end $pre$;

create function public.cc_prerregistro_datos(p_hash text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v uuid; r public.cc_prerregistros;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v := public._cc_visitor_por_hash(p_hash);
  if v is null then return null; end if;
  select * into r from public.cc_prerregistros where visitor_id = v;
  if not found then return null; end if;
  return jsonb_build_object('nombre', r.nombre, 'email', r.email, 'telefono', r.telefono, 'cedula', r.cedula, 'es_medico', r.es_medico, 'consent_at', r.consent_at);
end;
$$;
alter function public.cc_prerregistro_datos(text) owner to postgres;
revoke all on function public.cc_prerregistro_datos(text) from public, anon, authenticated;
grant execute on function public.cc_prerregistro_datos(text) to service_role;
