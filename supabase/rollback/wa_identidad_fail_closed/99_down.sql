-- R4-B1 · ROLLBACK (solo recurso documentado). ADVERTENCIA: restaura la vinculación automática por teléfono de la 167, es decir,
-- REINTRODUCE la vulnerabilidad (quien se registre con un teléfono ajeno lee los WhatsApp de esa persona). No ejecutar salvo
-- decisión expresa del dueño y con un reemplazo seguro en camino. No toca contactos, conversaciones ni mensajes.
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
create or replace function public._cc_wa_perfil(p_wa_id text) returns uuid
  language sql stable security definer set search_path = public as
$$
  select case when count(distinct x.id) = 1 then min(x.id::text)::uuid end
    from (select p.id from public.profiles p
           where p.role_id = 'doctor' and p.active is not false
             and public._tel10(coalesce(p.meta -> 'shipping' ->> 'phone', p.meta ->> 'phone')) = public._tel10(p_wa_id)
          union
          select k.profile_id from public.customers k join public.profiles p on p.id = k.profile_id and p.role_id = 'doctor'
           where k.active and k.profile_id is not null and public._tel10(k.phone) = public._tel10(p_wa_id)) x
$$;
alter function public._cc_wa_perfil(text) owner to postgres;
revoke all on function public._cc_wa_perfil(text) from public, anon, authenticated;

do $post$ begin
  if md5(pg_get_functiondef('public._cc_wa_perfil(text)'::regprocedure)) <> '12f258498b4287011bcda22829c9f07d' then
    raise exception 'R4-B1 down: _cc_wa_perfil no quedó idéntica a la 167';
  end if;
end $post$;
