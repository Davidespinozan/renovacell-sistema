-- CÉDULA ÚNICA (23 nov 2026, auditoría de altas). Una sola regla para la cédula profesional en todo el sistema: solo
-- números, de 5 a 8 dígitos (las antiguas de 5–6 y las actuales de 7–8), guardada limpia. Antes: 7–8 (alta desde el chat,
-- IA, cédula de la ficha), 5–12 (capturar cédula de una cuenta), 5–40 caracteres tal cual (prerregistro). Y los duplicados
-- se comparan siempre sobre la cédula limpia (antes, texto exacto: «12 345 678» no chocaba con «12345678»).
-- Misma regla en el código: supabase/functions/_shared/cedula.ts (cedulaCanonica).
create or replace function public._cedula_canonica(p text)
returns text language sql immutable as $f$
  select case when regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') ~ '^[0-9]{5,8}$' then regexp_replace(p, '[^0-9]', '', 'g') end
$f$;

do $m$
declare f text; v text;
begin
  foreach f in array array['cc_alta_cliente_conversacion', 'cc_ia_solicitar_alta', 'cliente_cedula_guardar'] loop
    select pg_get_functiondef(p.oid) into v from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if v is null or position($q$'^[0-9]{7,8}$'$q$ in v) = 0 then raise exception 'CEDULA-UNICA: % no es la esperada', f; end if;
    v := replace(v, $q$'^[0-9]{7,8}$'$q$, $q$'^[0-9]{5,8}$'$q$);
    v := replace(v, $q$x.meta ->> 'cedula' = v_ced$q$, $q$regexp_replace(coalesce(x.meta ->> 'cedula', ''), '[^0-9]', '', 'g') = v_ced$q$);
    v := replace(v, $q$p.meta ->> 'cedula' = v_ced$q$, $q$regexp_replace(coalesce(p.meta ->> 'cedula', ''), '[^0-9]', '', 'g') = v_ced$q$);
    v := replace(v, 'la cédula profesional tiene 7 u 8 dígitos', 'la cédula profesional son solo números, de 5 a 8 dígitos');
    execute v;
  end loop;

  v := pg_get_functiondef('public.doctor_capturar_cedula'::regproc);
  if position($q$'^[0-9]{5,12}$'$q$ in v) = 0 then raise exception 'CEDULA-UNICA: doctor_capturar_cedula no es la esperada'; end if;
  v := replace(v, $q$regexp_replace(btrim(coalesce(p_cedula, '')), '[[:space:]]+', '', 'g')$q$, $q$regexp_replace(coalesce(p_cedula, ''), '[^0-9]', '', 'g')$q$);
  v := replace(v, $q$'^[0-9]{5,12}$'$q$, $q$'^[0-9]{5,8}$'$q$);
  v := replace(v, '(5 a 12 dígitos)', '(5 a 8 dígitos)');
  execute v;

  v := pg_get_functiondef('public.cc_visitante_prerregistrar'::regproc);
  if position($q$v_ced text := nullif(btrim(coalesce(p_cedula, '')), '');$q$ in v) = 0 or position($q$(length(v_ced) < 5 or length(v_ced) > 40)$q$ in v) = 0 then
    raise exception 'CEDULA-UNICA: cc_visitante_prerregistrar no es la esperada'; end if;
  v := replace(v, $q$v_ced text := nullif(btrim(coalesce(p_cedula, '')), '');$q$, $q$v_ced text := nullif(regexp_replace(coalesce(p_cedula, ''), '[^0-9]', '', 'g'), '');$q$);
  v := replace(v, $q$(length(v_ced) < 5 or length(v_ced) > 40)$q$, $q$v_ced !~ '^[0-9]{5,8}$'$q$);
  execute v;
end $m$;
revoke all on function public._cedula_canonica(text) from public, anon;
grant execute on function public._cedula_canonica(text) to authenticated, service_role;
