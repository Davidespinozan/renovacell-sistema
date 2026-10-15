-- AVISOS DESCARTADOS · rollback de la migración 164.
drop trigger comm_outbox_no_revivir on public.comm_outbox;
drop function public._comm_no_revivir();
