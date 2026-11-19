-- RESPONDER A UN MENSAJE EN EL CHAT DEL EQUIPO (19 nov 2026, dueño: «¿no lo aplicaste también en chat del equipo?»).
-- messages.responde_a: el mensaje citado. Solo puede ser de la MISMA conversación (si no, se descarta: nunca se cuela un
-- mensaje de un chat al que no perteneces). Si el original se borra, la cita se quita sola.
alter table public.messages add column responde_a uuid references public.messages(id) on delete set null;

create function public._messages_responde_a_tr() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if new.responde_a is not null and not exists (select 1 from public.messages m where m.id = new.responde_a and m.conversation_id = new.conversation_id) then
    new.responde_a := null;
  end if;
  return new;
end;
$$;
revoke all on function public._messages_responde_a_tr() from public, anon, authenticated;
create trigger messages_responde_a before insert on public.messages for each row when (new.responde_a is not null) execute function public._messages_responde_a_tr();
