-- RESPONDER A UN MENSAJE (19 nov 2026, vendedora vía dueño: «deslizar un mensaje para responder, como en WhatsApp»).
--   · cc_mensaje_respuestas: qué mensaje responde a cuál (cc_messages es solo-agregar: la relación vive aparte).
--   · _cc_respuesta_registrar (solo servidor): ambos mensajes en la MISMA conversación; idempotente.
--   La Edge `chat` la registra al enviar; la Edge `meta-webhook`, cuando el cliente responde citando desde WhatsApp; y la
--   salida de WhatsApp manda la respuesta citada (context.message_id) para que el cliente también la vea así.
create table public.cc_mensaje_respuestas (
  message_id uuid primary key references public.cc_messages(id) on delete cascade,
  responde_a uuid not null references public.cc_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (message_id <> responde_a)
);
create index ix_cc_mensaje_respuestas_a on public.cc_mensaje_respuestas (responde_a);
alter table public.cc_mensaje_respuestas enable row level security;
revoke all on public.cc_mensaje_respuestas from public, anon, authenticated;
grant select on public.cc_mensaje_respuestas to service_role;

create function public._cc_respuesta_registrar(p_message uuid, p_responde_a uuid) returns boolean language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_message is null or p_responde_a is null or p_message = p_responde_a then return false; end if;
  if (select conversation_id from public.cc_messages where id = p_message) is distinct from (select conversation_id from public.cc_messages where id = p_responde_a) then return false; end if;
  insert into public.cc_mensaje_respuestas (message_id, responde_a) values (p_message, p_responde_a) on conflict (message_id) do nothing;
  return true;
end;
$$;
alter function public._cc_respuesta_registrar(uuid, uuid) owner to postgres;
revoke all on function public._cc_respuesta_registrar(uuid, uuid) from public, anon, authenticated;
grant execute on function public._cc_respuesta_registrar(uuid, uuid) to service_role;
