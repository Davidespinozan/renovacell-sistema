-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CS-1A.6 · conciliación: transición `authorized → declined` SOLO para la reversa confirmada de una autorización (migración 186)
--   Una autorización sin captura retiene dinero en el banco. Conciliación puede REVERSARLA (POST /pts/v2/payments/{id}/reversals
--   → status REVERSED). Con la reversa confirmada el intento termina como `declined` (sin asiento; la reserva se libera).
--   La 184 no contemplaba esa salida (authorized → captured | unknown). Cambio mínimo: se añade `declined` a `authorized`.
--   Una reversa DESCONOCIDA (timeout) no libera nada: va a unknown_requires_reconciliation (ya permitido).
--   Lo demás de la máquina de estados no cambia. Rollback: supabase/rollback/cs1a6_reversa/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cs_transicion_valida(text,text)') is null then raise exception 'CS1A6: falta CS-1A.1a'; end if;
  if public._cs_transicion_valida('authorized', 'declined') then raise exception 'CS1A6: ya aplicada'; end if;
end $pre$;

create or replace function public._cs_transicion_valida(p_de text, p_a text) returns boolean
  language sql immutable parallel safe as
$$
  select case
    when p_de = 'created'        then p_a in ('tokenized','failed_safe_to_retry','expired')
    when p_de = 'tokenized'      then p_a in ('auth_setup','failed_safe_to_retry','expired')
    when p_de = 'auth_setup'     then p_a in ('auth_pending','failed_safe_to_retry','expired')
    when p_de = 'auth_pending'   then p_a in ('auth_challenge','auth_validated','declined','failed_safe_to_retry','expired')
    when p_de = 'auth_challenge' then p_a in ('auth_validated','declined','failed_safe_to_retry','expired')
    when p_de = 'auth_validated' then p_a in ('authz_sent','failed_safe_to_retry','expired')
    when p_de = 'authz_sent'     then p_a in ('authorized','captured','declined','unknown_requires_reconciliation')
    when p_de = 'authorized'     then p_a in ('captured','declined','unknown_requires_reconciliation')   -- CS-1A.6: declined = reversa CONFIRMADA
    when p_de = 'captured'       then p_a in ('unknown_requires_reconciliation')          -- a posted solo por cs_intento_contabilizar
    when p_de = 'unknown_requires_reconciliation' then p_a in ('authorized','captured','declined','failed_safe_to_retry')  -- solo con evidencia
    else false
  end
$$;

do $post$ begin
  if not public._cs_transicion_valida('authorized', 'declined') then raise exception 'CS1A6: no quedó la transición'; end if;
  if public._cs_transicion_valida('posted', 'declined') or public._cs_transicion_valida('declined', 'authorized') or public._cs_transicion_valida('captured', 'declined') then raise exception 'CS1A6: transición indebida'; end if;
end $post$;
