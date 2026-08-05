-- Solicitante de un recurso como user_id (auditoría: notificar al entregar).
-- `requested_by` es solo un nombre de display; para AVISARLE al solicitante cuando su
-- recurso queda listo hace falta su id de usuario. Se guarda al crear la solicitud.
alter table public.resource_requests add column if not exists requested_by_id uuid references auth.users(id);
