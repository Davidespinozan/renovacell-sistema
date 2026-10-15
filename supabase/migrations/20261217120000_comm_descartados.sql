-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- AVISOS DESCARTADOS (migración 164) · UN AVISO DE GUÍA ANULADA NUNCA VUELVE A LA COLA
--   Hallazgo (15 oct 2026): al anular una guía (149) su aviso "tu pedido va en camino" queda fallido con GUIA_ANULADA,
--   pero "Reintentar" en Mensajes al cliente lo regresaba a la cola y salió con el número anulado.
--   · _comm_no_revivir (trigger)   NUEVA. Un aviso descartado por GUIA_ANULADA no puede volver a 'pendiente' por ningún
--                                   camino (Reintentar, comandos o escritura directa del servidor).
--   NO cambia: comm_reintentar, comm_reclamar, comm_resolver ni los demás avisos.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/comm_descartados/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._comm_no_revivir()') is not null then raise exception 'COMM-DESCARTADOS: ya aplicada'; end if;
  if to_regclass('public.comm_outbox') is null then raise exception 'COMM-DESCARTADOS: falta W4'; end if;
end $pre$;

create function public._comm_no_revivir() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if coalesce(old.last_error, '') like 'GUIA_ANULADA%' and new.status in ('pendiente', 'enviando') then
    raise exception 'COMM_DESCARTADO: este aviso era de una guía que se anuló; no se reenvía (la guía nueva genera su propio aviso)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
alter function public._comm_no_revivir() owner to postgres;
revoke all on function public._comm_no_revivir() from public, anon, authenticated;
create trigger comm_outbox_no_revivir before update of status on public.comm_outbox for each row execute function public._comm_no_revivir();
