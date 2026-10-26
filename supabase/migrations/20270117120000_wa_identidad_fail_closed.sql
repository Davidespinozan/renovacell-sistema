-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-B1 · WhatsApp: el teléfono NO prueba identidad (fail-closed)
--   Hecho (auditoría R4-A, 26 oct 2026): _cc_wa_perfil (167) ligaba un contacto de WhatsApp a un doctor comparando los
--   últimos 10 dígitos con meta.shipping.phone / meta.phone (los escribe el propio doctor al registrarse o al editar su
--   perfil, sin confirmación) o customers.phone, sin exigir verificación. cc_wa_entrante reintenta la liga en cada mensaje y
--   desde ese momento los WhatsApp de ese número entran a la conversación del doctor, que la lee por RLS (ccm_select_propias)
--   y en vivo por Realtime. Así, quien se registrara con el número de otra persona leía sus mensajes, aun en modo espejo.
--   Exigir `verified` no basta: un doctor verificado también puede escribir el teléfono de otra persona.
--   Corrección mínima: _cc_wa_perfil ya no liga NUNCA de forma automática. Todo contacto de WhatsApp queda como visitante
--   interno (conversación aislada: la ven Dirección y la vendedora asignada). La vinculación con un doctor será explícita y
--   autorizada por personal (bloque posterior). No toca wa_id, contactos, conversaciones ni mensajes, ni fusiona historiales.
--   Precondición: 0 contactos ligados (si hubiera alguno, se aborta para revisarlo a mano).
--   Rollback (solo recurso documentado, reintroduce la vulnerabilidad): supabase/rollback/wa_identidad_fail_closed/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cc_wa_perfil(text)') is null then raise exception 'R4-B1: falta _cc_wa_perfil (167)'; end if;
  if md5(pg_get_functiondef('public._cc_wa_perfil(text)'::regprocedure)) <> '12f258498b4287011bcda22829c9f07d' then
    raise exception 'R4-B1: _cc_wa_perfil no tiene la definición esperada de la 167 (¿ya aplicada o cambiada?)';
  end if;
  if exists (select 1 from public.cc_wa_contactos where profile_id is not null) then
    raise exception 'R4-B1: hay contactos de WhatsApp ligados a un perfil; revisarlos a mano antes de aplicar';
  end if;
end $pre$;

-- Misma firma, mismo dueño y mismos permisos. Ninguna coincidencia de teléfono otorga identidad.
create or replace function public._cc_wa_perfil(p_wa_id text) returns uuid
  language sql stable security definer set search_path = public as
$$ select null::uuid $$;
alter function public._cc_wa_perfil(text) owner to postgres;
revoke all on function public._cc_wa_perfil(text) from public, anon, authenticated;

do $post$ begin
  if position('_tel10' in pg_get_functiondef('public._cc_wa_perfil(text)'::regprocedure)) > 0 then raise exception 'R4-B1: _cc_wa_perfil sigue comparando teléfonos'; end if;
  if public._cc_wa_perfil('5216671647799') is not null then raise exception 'R4-B1: _cc_wa_perfil devolvió un perfil'; end if;
  if has_function_privilege('authenticated', 'public._cc_wa_perfil(text)', 'execute') or has_function_privilege('anon', 'public._cc_wa_perfil(text)', 'execute') then
    raise exception 'R4-B1: _cc_wa_perfil quedó ejecutable por clientes';
  end if;
  if (select proowner::regrole::text from pg_proc where oid = 'public._cc_wa_perfil(text)'::regprocedure) <> 'postgres' then raise exception 'R4-B1: dueño inesperado'; end if;
  if exists (select 1 from public.cc_wa_contactos where profile_id is not null) then raise exception 'R4-B1: apareció un contacto ligado'; end if;
end $post$;
