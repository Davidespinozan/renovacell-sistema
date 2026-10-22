-- CS-1A.6 (186) · rollback: la máquina de estados vuelve a la de la 184 (authorized → captured | unknown).
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
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
    when p_de = 'authorized'     then p_a in ('captured','unknown_requires_reconciliation')
    when p_de = 'captured'       then p_a in ('unknown_requires_reconciliation')          -- a posted solo por cs_intento_contabilizar
    when p_de = 'unknown_requires_reconciliation' then p_a in ('authorized','captured','declined','failed_safe_to_retry')  -- solo con evidencia
    else false
  end
$$;
