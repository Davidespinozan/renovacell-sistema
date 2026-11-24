-- ROLLBACK IA-MODO (20270407840000): restaura cc_seguimiento_despachar e ia_config previos, quita el RPC y las columnas.
begin;
CREATE OR REPLACE FUNCTION public.cc_seguimiento_despachar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.cc_seguimiento_config; c record; v_local timestamp := now() at time zone 'America/Mazatlan'; v_conv uuid; v_seller uuid; v_cu uuid; v_puede text;
  v_t jsonb; v_seq bigint; v_cid text; v_nombre text; n int := 0; v_que text;
begin
  select * into cfg from public.cc_seguimiento_config where id;
  if not (cfg.carrito or cfg.recompra or cfg.promo) then return 0; end if;
  if (extract(isodow from v_local) = 7 and not cfg.domingo) or extract(hour from v_local) < cfg.hora_desde or extract(hour from v_local) >= cfg.hora_hasta then return 0; end if;
  for c in select * from public._cc_seg_candidatos(cfg) limit cfg.max_por_corrida * 4 loop
    exit when n >= cfg.max_por_corrida;
    v_conv := (public._cc_conversacion_de(null, c.profile_id) ->> 'conversation_id')::uuid;
    if v_conv is null then continue; end if;
    v_puede := public._cc_seg_puede(c.profile_id, v_conv, cfg);
    v_cu := public._cc_chk_customer(c.profile_id);
    v_seller := coalesce((select seller_profile_id from public.cc_conversations where id = v_conv), public._cc_vendedor_de_cliente(v_cu));
    v_nombre := coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Un cliente');
    v_que := case c.tipo when 'carrito' then 'dejó su carrito sin terminar' when 'recompra' then 'ya le toca volver a pedir ' || coalesce((select name from public.products where id = c.product_id), 'lo de siempre')
                         else 'compró antes un producto que hoy está en promoción' end;
    if v_puede in ('asesor', 'activo') then
      -- No se interrumpe: el vendedor se entera y decide. El evento cuenta como atendido.
      if v_seller is not null then perform public._cc_notificar('seguimiento', v_conv, array[v_seller], null, v_nombre || ' ' || v_que || '.', 'asesorias', 'seg:' || c.profile_id || ':' || c.tipo || ':' || md5(c.clave)); end if;
      insert into public.cc_seguimiento_envios (profile_id, tipo, clave, conversation_id, product_id) values (c.profile_id, c.tipo, c.clave, v_conv, c.product_id) on conflict do nothing;
      continue;
    end if;
    if v_puede <> 'ok' then continue; end if;   -- respiro o tope semanal: se reintenta en otra corrida
    v_t := case c.tipo when 'carrito' then public._cc_seg_texto_carrito(c.profile_id, c.ref)
                       when 'recompra' then public._cc_seg_texto_recompra(c.profile_id, c.product_id, c.qty, c.fecha)
                       else public._cc_seg_texto_promo(c.profile_id, c.ref, c.product_id) end;
    if v_t is null or nullif(v_t ->> 'texto', '') is null then
      insert into public.cc_seguimiento_envios (profile_id, tipo, clave, conversation_id, product_id) values (c.profile_id, c.tipo, c.clave, v_conv, c.product_id) on conflict do nothing;
      continue;
    end if;
    v_cid := 'tpl:seg:' || c.tipo || ':' || c.profile_id || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = v_conv returning ultimo_seq into v_seq;
    insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
    values (v_conv, v_seq, 'ai', v_cid, v_t ->> 'texto', md5(v_t ->> 'texto')) on conflict do nothing;
    insert into public.cc_seguimiento_envios (profile_id, tipo, clave, conversation_id, product_id, monto)
    values (c.profile_id, c.tipo, c.clave, v_conv, c.product_id, (v_t ->> 'monto')::numeric) on conflict do nothing;
    if v_seller is not null then
      perform public._cc_notificar('seguimiento', v_conv, array[v_seller], null, v_nombre || ' ' || v_que || '; la IA ya le escribió.', 'asesorias', 'seg:' || c.profile_id || ':' || c.tipo || ':' || md5(c.clave));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$function$

;
create or replace function public.ia_config() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc_exige_admin();
  return (select jsonb_build_object('modelo_portal', modelo_portal, 'esfuerzo_portal', esfuerzo_portal, 'updated_at', updated_at,
    'modelos', jsonb_build_array('claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5')) from public.cc_ia_config where id);
end;
$$;
drop function if exists public.ia_modo_guardar(text);
alter table public.cc_ia_config drop constraint if exists ck_cc_ia_config_modo;
alter table public.cc_ia_config drop column if exists modo_at, drop column if exists modo_por, drop column if exists modo;
delete from supabase_migrations.schema_migrations where version = '20270407840000';
commit;
