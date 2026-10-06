-- ============================================================================
-- CC-6 · ROLLBACK. Retira revisiones, operaciones, eventos y comandos de checkout. No toca CC-5,
-- W1 ni los pedidos ya creados (son pedidos canónicos W1; permanecen). UNA transacción.
-- ============================================================================
drop function if exists public.cc_checkout_confirmar(uuid, text, int);
drop function if exists public.cc_checkout_revisar(uuid, uuid);
drop function if exists public._cc_chk_resultado(uuid, uuid, boolean);
drop function if exists public._cc_chk_seller(uuid);
drop function if exists public._cc_chk_direccion(uuid, uuid);
drop function if exists public._cc_chk_lineas(uuid, uuid);
drop function if exists public._cc_chk_evento(uuid, uuid, uuid, text, jsonb);
drop table if exists public.cc_checkout_events;
drop table if exists public.cc_checkout_operations;
drop table if exists public.cc_checkout_reviews;

-- _cc_solo_servicio: texto CC-4 (sin la bandera interna).
create or replace function public._cc_solo_servicio() returns void
  language plpgsql stable set search_path = public as
$$ begin if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then raise exception 'NO_AUTORIZADO: solo el servidor orquesta la IA' using errcode = 'insufficient_privilege'; end if; end $$;
