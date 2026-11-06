-- ASISTENTE DEL EQUIPO (6 nov 2026, dueño: «un agente de IA, igual que en Sala, que les responda todo tipo de preguntas sobre
-- su sistema»). v1 SOLO CONSULTA: el Edge `asistente-equipo` llama estas funciones con el JWT de quien pregunta, así que cada
-- persona ve solo lo que su rol ya le permite. Las de clientes reutilizan buscar_clientes_pos y cliente_360 (ya con permisos).
--   · ia_eq_conversaciones(texto): conversaciones recientes por nombre o número, con QUIÉN la tiene, por qué (bitácora de
--     ruteo: reparto, cartera, traspaso, bot) y los últimos mensajes. Dirección: todas. Ventas: las suyas o de su cartera.
--   · ia_eq_pedido(folio): estado, pago y envío. Dirección y su vendedor ven montos; Almacén, Empaque y Chofer ven la logística.
--   · ia_eq_consultas: bitácora de cada pregunta (la escribe el servidor; la lee Dirección).

create table if not exists public.ia_eq_consultas (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id),
  rol text,
  pregunta text not null,
  respuesta text,
  herramientas jsonb not null default '[]'::jsonb,
  modelo text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists ia_eq_consultas_fecha on public.ia_eq_consultas (created_at desc);
alter table public.ia_eq_consultas enable row level security;
drop policy if exists ia_eq_consultas_dir on public.ia_eq_consultas;
create policy ia_eq_consultas_dir on public.ia_eq_consultas for select using (public.auth_role() = 'admin');
revoke all on public.ia_eq_consultas from anon;
revoke insert, update, delete, truncate, references, trigger on public.ia_eq_consultas from authenticated;

create or replace function public.ia_eq_conversaciones(p_texto text, p_limite int default 3)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_rol text := public.auth_role();
  v_t text := btrim(coalesce(p_texto, '')); v_dig text := regexp_replace(coalesce(p_texto, ''), '\D', '', 'g');
  v_lim int := least(greatest(coalesce(p_limite, 3), 1), 5); r jsonb;
begin
  if v_uid is null or v_rol not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO: solo Dirección y Ventas consultan conversaciones' using errcode = 'insufficient_privilege'; end if;
  if char_length(v_t) < 3 then raise exception 'BUSQUEDA_CORTA: escribe al menos 3 letras o el número' using errcode = 'check_violation'; end if;
  with base as (
    select c.*, w.wa_id, w.nombre as wa_nombre, cu.full_name as cliente, pf.full_name as cuenta
      from public.cc_conversations c
      left join public.cc_wa_contactos w on w.visitor_id = c.visitor_id
      left join public.customers cu on cu.id = c.customer_id
      left join public.profiles pf on pf.id = c.profile_id
     where c.last_message_at > now() - interval '60 days'
       and (
         (char_length(v_dig) >= 7 and (right(coalesce(w.wa_id, ''), 10) = right(v_dig, 10) or right(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), 10) = right(v_dig, 10)))
         or (char_length(v_dig) < 7 and (w.nombre ilike '%' || v_t || '%' or cu.full_name ilike '%' || v_t || '%' or pf.full_name ilike '%' || v_t || '%'))
       )
       and (v_rol = 'admin' or c.seller_profile_id = v_uid
            or (c.customer_id is not null and public._cc_vendedor_de_cliente(c.customer_id) = v_uid)
            or exists (select 1 from public.cc_participants pa where pa.conversation_id = c.id and pa.profile_id = v_uid))
     order by c.last_message_at desc
     limit v_lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'contacto', coalesce(b.cliente, b.cuenta, b.wa_nombre, case when b.wa_id is not null then '+' || b.wa_id end, 'Visitante'),
    'whatsapp', b.wa_id,
    'canal', case when b.wa_id is not null then 'whatsapp' when b.profile_id is not null then 'portal' else 'chat/otro' end,
    'modo', b.modo, 'estado', b.estado,
    'atiende_ahora', public._cc_nombre_personal(b.seller_profile_id),
    'cliente_ligado', b.cliente,
    'vendedor_de_cartera', case when b.customer_id is not null then public._cc_nombre_personal(public._cc_vendedor_de_cliente(b.customer_id)) end,
    'ultimo_mensaje', to_char(b.last_message_at at time zone 'America/Mazatlan', 'DD/MM HH24:MI'),
    'bitacora', (select coalesce(jsonb_agg(jsonb_build_object(
        'cuando', to_char(e.created_at at time zone 'America/Mazatlan', 'DD/MM HH24:MI'), 'que', e.tipo,
        'vendedor', public._cc_nombre_personal(nullif(e.detalle ->> 'seller', '')::uuid),
        'antes', public._cc_nombre_personal(nullif(e.detalle ->> 'anterior', '')::uuid),
        'motivo', e.detalle ->> 'motivo', 'origen', e.detalle ->> 'origen',
        'por', public._cc_nombre_personal(e.actor_profile_id)) order by e.created_at), '[]'::jsonb)
      from (select * from public.cc_conversation_events e0 where e0.conversation_id = b.id
              and e0.tipo in ('human_requested', 'human_assigned', 'seller_unassigned', 'human_started', 'human_ended', 'bot_detectado', 'conversation_closed')
              order by e0.created_at desc limit 15) e),
    'mensajes', (select coalesce(jsonb_agg(jsonb_build_object(
        'cuando', to_char(m.created_at at time zone 'America/Mazatlan', 'DD/MM HH24:MI'),
        'quien', case m.actor_type when 'ai' then 'IA' when 'system' then 'sistema' when 'seller' then coalesce(public._cc_nombre_personal(m.actor_profile_id), 'vendedor')
                   when 'admin' then coalesce(public._cc_nombre_personal(m.actor_profile_id), 'Dirección') else 'cliente' end,
        'texto', left(m.content, 400)) order by m.seq), '[]'::jsonb)
      from (select * from public.cc_messages m0 where m0.conversation_id = b.id order by m0.seq desc limit 12) m)
  ) order by b.last_message_at desc), '[]'::jsonb) into r from base b;
  return r;
end;
$$;

create or replace function public.ia_eq_pedido(p_folio text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_rol text := public.auth_role(); o record; v_actor text; v_montos boolean; v_log boolean;
begin
  if v_uid is null or v_rol not in ('admin', 'pos', 'warehouse', 'packing', 'driver') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into o from public.orders where upper(external_ref) = upper(btrim(coalesce(p_folio, ''))) limit 1;
  if not found then return jsonb_build_object('encontrado', false); end if;
  v_actor := case when o.customer_id is not null then public._c360_actor(o.customer_id) end;
  v_montos := v_rol = 'admin' or v_actor is not null;
  v_log := v_rol in ('warehouse', 'packing', 'driver');
  if not v_montos and not v_log then raise exception 'NO_AUTORIZADO: ese pedido no es de tu cartera' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object('encontrado', true, 'folio', o.external_ref, 'estado', o.status, 'creado', to_char(o.created_at at time zone 'America/Mazatlan', 'DD/MM/YYYY HH24:MI'),
    'cliente', (select full_name from public.customers where id = o.customer_id),
    'pago', case when v_montos then jsonb_build_object('estado', o.payment_status, 'metodo', o.payment_method, 'total', o.total, 'envio', o.shipping_cost, 'moneda', o.currency) end,
    'factura_pedida', case when v_montos then o.invoice_requested end,
    'envios', (select coalesce(jsonb_agg(jsonb_build_object('paqueteria', s.carrier, 'guia', s.tracking_number, 'estado', s.status,
        'entrega_estimada', to_char(s.estimated_delivery_at at time zone 'America/Mazatlan', 'DD/MM/YYYY'),
        'entregado', to_char(s.delivered_at at time zone 'America/Mazatlan', 'DD/MM/YYYY HH24:MI'), 'recibio', s.received_by, 'incidencia', s.incident) order by s.created_at), '[]'::jsonb)
      from public.shipments s where s.order_id = o.id));
end;
$$;

revoke all on function public.ia_eq_conversaciones(text, int) from public, anon;
revoke all on function public.ia_eq_pedido(text) from public, anon;
grant execute on function public.ia_eq_conversaciones(text, int) to authenticated;
grant execute on function public.ia_eq_pedido(text) to authenticated;
