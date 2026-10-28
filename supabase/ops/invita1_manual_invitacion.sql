-- INVITA-1 · Manual de ventas: qué contestar cuando un cliente actual pregunta por la invitación (correo o WhatsApp)
-- para crear su cuenta. Entrada nueva (tema verificación) y su aprobación, autorizadas por el dueño ("DALE", 27 oct 2026).
-- Misma regla que R4-C10: 0 claims prohibidos y evento de aprobación en la bitácora. Idempotente por (tema, título).
begin;
insert into public.cc_company_knowledge (tema, titulo, contenido, version, audiencia, importado_de)
select 'verificacion', 'Invitación para clientes actuales',
  'Si ya eras cliente de Renovacell, te enviamos por correo o WhatsApp una invitación para crear tu cuenta en nuestro portal para profesionales. Es un mensaje real de Renovacell.' || E'\n' ||
  'Tu cuenta queda verificada desde el inicio, sin volver a mandar tu cédula: solo abre el enlace, escribe tu correo y crea tu contraseña. Ahí verás precios, harás pedidos y hablarás con tu asesor.' || E'\n' ||
  'El enlace es personal y vence en 14 días. Si ya venció, no te llegó o tienes problemas para entrar, tu asesor te manda uno nuevo.' || E'\n' ||
  'Puedes seguir comprando por este WhatsApp como siempre; la cuenta es opcional.',
  1, 'public', 'INVITA-1'
 where not exists (select 1 from public.cc_company_knowledge where tema = 'verificacion' and titulo = 'Invitación para clientes actuales');
do $a$
declare r record;
begin
  select id, version, titulo, contenido into r from public.cc_company_knowledge where tema = 'verificacion' and titulo = 'Invitación para clientes actuales' and estado = 'draft';
  if not found then raise notice 'ya aprobada: nada que hacer'; return; end if;
  if exists (select 1 from jsonb_array_elements(public.cc_revisar_claims(r.titulo || ' ' || r.contenido)) x where x ->> 'tipo' = 'prohibido') then raise exception 'ALTO: claim prohibido'; end if;
  update public.cc_company_knowledge set estado = 'approved', approved_at = now() where id = r.id;
  perform public._cc_evento_k('empresa', r.id, 'aprobar', r.version, jsonb_build_object('autorizado_por', 'dueño (vía Claude, INVITA-1)'));
end $a$;
select tema, titulo, estado from public.cc_company_knowledge where titulo = 'Invitación para clientes actuales';
commit;
