-- IA · TANDA 2 (23 nov 2026) · segunda parte del análisis de 34 conversaciones reales (hallazgos 3, 7, 8 y 9). Esta migración
-- trae la parte de BASE; la de la IA vive en _shared/ia (conversacion.ts, orquestador, política, validación) y en las Edges.
-- Nada aquí da a la IA identidad por el teléfono (R4-B1) ni cifras de existencias o precios a un contacto sin verificar.
--
--   A) BÚSQUEDA TOLERANTE: «linurasse», «Xomeen»/«Xeomin», «nabota 200u», «tirze», «terapia neural». pg_trgm (en el esquema
--      `extensions`, como en Supabase) + normalización de presentaciones («200u», «200 unidades» → «200 ui») + sinónimos de
--      palabra completa (cc_busqueda_sinonimos: genérico → marca del catálogo). cc_buscar_productos conserva su firma y su
--      visibilidad por audiencia: lo «parecido» solo se busca si no hubo coincidencia fuerte y nunca pasa de 70 puntos (la
--      pre-búsqueda del canal solo toma ≥ 75: un parecido nunca se confirma solo).
--   B) cc_ia_producto_estado: lo que la IA PUEDE afirmar de lo que pidió el cliente. Para cada producto que coincide (marca y,
--      si la dijo, presentación): si se puede surtir AHORA (activo, vendible y con existencia no caducada) — un sí/no, nunca
--      una cifra —, si la presentación que pidió no la manejamos, y hasta 3 alternativas con existencia (misma marca en la
--      presentación más cercana → otra marca de la misma categoría con esa presentación → la misma categoría), como hacen
--      las vendedoras («Nabota 200 agotado; tengo Nabota 150 y Wondertox 200»). Solo productos del catálogo de clientes
--      (portal o landing): lo interno nunca sale. Ids solo de lo que esa audiencia ya ve en la búsqueda.
--   C) cc_alta_wa_cerrar: el aviso de «verificado» ya no dice «verificado(a)», ya no manda enlaces técnicos (solo el dominio de
--      la app; cualquier otro se descarta y se explica «¿Olvidaste tu contraseña?») y no habla encima de una persona del
--      equipo que está atendiendo (mensaje corto, sin «te cotizo»).
--   D) Examen de la IA: casos CV13–CV22 (categoría «conversacion»), anonimizados.

-- ── A) Búsqueda tolerante ──────────────────────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.cc_busqueda_sinonimos (
  termino_norm text primary key check (termino_norm = public._cc_norm(termino_norm) and length(termino_norm) between 3 and 60),
  reemplazo    text not null check (reemplazo = public._cc_norm(reemplazo) and length(reemplazo) between 2 and 60),
  nota         text,
  created_at   timestamptz not null default now()
);
alter table public.cc_busqueda_sinonimos enable row level security;   -- sin políticas: solo funciones definer / servicio
revoke all on table public.cc_busqueda_sinonimos from anon, authenticated;
comment on table public.cc_busqueda_sinonimos is 'IA-TANDA2 · genérico o error común → término del catálogo (palabra completa) para cc_buscar_productos.';

insert into public.cc_busqueda_sinonimos (termino_norm, reemplazo, nota) values
  ('tirzepatida', 'mounjaro', 'genérico → marca (A·C0 seq3)'),
  ('tirzepatidas', 'mounjaro', 'genérico → marca (A·C0 seq14)'),
  ('tirze', 'mounjaro', 'abreviatura'),
  ('tirzepatide', 'mounjaro', 'en inglés'),
  ('semaglutida', 'wegovy', 'genérico → marca'),
  ('liraglutida', 'saxenda', 'genérico → marca'),
  ('xeomin', 'xeomeen', 'nombre comercial original (B·C3 seq32)'),
  ('xeomen', 'xeomeen', 'error común'),
  ('xomeen', 'xeomeen', 'error común'),
  ('terapia neural', 'tnm', 'TNM = terapia neural (B·C7 seq1)'),
  ('linurasse', 'linurase', 'error común (A·C2 seq4)'),
  ('linurace', 'linurase', 'error común'),
  ('botaon', 'botaone', 'error común'),
  ('bota one', 'botaone', 'separado'),
  ('wonder tox', 'wondertox', 'separado'),
  ('inotox', 'innotox', 'error común')
on conflict (termino_norm) do nothing;

-- Texto de búsqueda normalizado: acentos y mayúsculas (_cc_norm), signos, presentación («200u», «200 unidades» → «200 ui»;
-- «5mg» → «5 mg»), sinónimos de palabra completa, cantidad al inicio («10 linurase») y palabras de relleno.
create or replace function public._cc_ia_q(p text) returns text
  language plpgsql stable set search_path = public as
$$
declare q text := public._cc_norm(p); r record;
begin
  if q is null then return null; end if;
  q := regexp_replace(q, '[¿?¡!,;:"«»()*]+', ' ', 'g');
  q := regexp_replace(q, '\m(\d+)\s*(u|ui|uds?|unidades|units?|iu)\M', '\1 ui', 'g');
  q := regexp_replace(q, '\m(\d+(\.\d+)?)\s*(mg|ml|cc)\M', '\1 \3', 'g');
  for r in select s.termino_norm, s.reemplazo from public.cc_busqueda_sinonimos s order by length(s.termino_norm) desc loop
    q := regexp_replace(q, '\m' || r.termino_norm || '\M', r.reemplazo, 'g');
  end loop;
  q := btrim(regexp_replace(q, '\s+', ' ', 'g'));
  if q ~ ' ' then
    q := regexp_replace(q, '^\d{1,3} (?=[a-z])', '');   -- «10 linurase 100 ui» → la cantidad no es parte del nombre
    q := btrim(regexp_replace(' ' || q || ' ', ' (de|del|la|el|los|las|un|una|unos|unas|por|favor|porfa|tiene|tienen|tienes|manejan|manejas|hay|toxina|toxinas)(?= )', '', 'g'));
  end if;
  return nullif(btrim(regexp_replace(q, '\s+', ' ', 'g')), '');
end;
$$;
revoke all on function public._cc_ia_q(text) from public, anon, authenticated;
grant execute on function public._cc_ia_q(text) to service_role;

-- Parecido de texto (0..1): el mejor tramo del nombre contra lo que escribió. Una sola función para la búsqueda y el estado.
create or replace function public._cc_parecido(p_q text, p_nombre text) returns real
  language sql stable set search_path = public as
$$ select coalesce(extensions.word_similarity(coalesce(p_q, ''), coalesce(public._cc_norm(p_nombre), '')), 0)::real $$;
revoke all on function public._cc_parecido(text, text) from public, anon, authenticated;
grant execute on function public._cc_parecido(text, text) to service_role;

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.cc_buscar_productos(text,integer,text)'::regprocedure);
  if position('q text := public._cc_norm(p_q); lim int' in d) = 0
     or position('select p.id, ''sku'' as via, 100 as pts from vis p where lower(p.sku) = q' in d) = 0
     or position('), mejor as (' in d) = 0
     or position('from cand c group by c.id' in d) = 0
     or position('parecido' in d) > 0 then
    raise exception 'IA-TANDA2: cambió cc_buscar_productos; revisar antes de aplicar';
  end if;
  -- qb: lo que escribió SIN la presentación («innotox 100 ui» → «innotox»): el parecido se mide sobre la marca, no sobre «100 ui»
  d := replace(d, 'q text := public._cc_norm(p_q); lim int', 'q text := public._cc_ia_q(p_q); q0 text := public._cc_norm(p_q);
  qb text := btrim(regexp_replace(coalesce(public._cc_ia_q(p_q), ''''), ''(^| )\d+(\.\d+)?( (ui|mg|ml|cc))?(?= |$)'', '' '', ''g'')); lim int');
  d := replace(d, 'select p.id, ''sku'' as via, 100 as pts from vis p where lower(p.sku) = q', 'select p.id, ''sku'' as via, 100 as pts from vis p where lower(p.sku) in (q, q0)');
  -- IA-TANDA2 · lo «parecido» (errores de dedo) solo si no hubo una coincidencia fuerte; tope 70 (< 75 de la pre-búsqueda)
  d := replace(d, '), mejor as (', '), parecido as (
     select p.id, ''parecido'' as via, (50 + round(14 * s.sim + 6 * extensions.similarity(qb, coalesce(public._cc_norm(p.name), ''''))))::int as pts
       from vis p cross join lateral (select greatest(public._cc_parecido(qb, p.name), public._cc_parecido(qb, p.family)) as sim) s
      where length(qb) >= 4 and qb ~ ''[a-z]{3}'' and s.sim >= 0.5 and not exists (select 1 from cand x where x.pts >= 55)
     union all
     select a.product_id, ''parecido'', (50 + round(20 * public._cc_parecido(qb, a.alias_norm)))::int
       from public.cc_product_aliases a join vis p on p.id = a.product_id
      where a.activo and length(qb) >= 4 and public._cc_parecido(qb, a.alias_norm) >= 0.5 and not exists (select 1 from cand x where x.pts >= 55)
   ), mejor as (');
  d := replace(d, 'from cand c group by c.id', 'from (select * from cand union all select * from parecido) c group by c.id');
  execute d;
  d := pg_get_functiondef('public.cc_buscar_productos(text,integer,text)'::regprocedure);
  if position('public._cc_ia_q(p_q)' in d) = 0 or position('parecido as (' in d) = 0 or position('select * from parecido' in d) = 0 then
    raise exception 'IA-TANDA2: cc_buscar_productos no quedó parchada';
  end if;
end $patch$;

-- ── B) Lo que la IA puede afirmar de lo que pidió el cliente ───────────────────────────────────────────────────────────
create or replace function public.cc_ia_producto_estado(p_q text, p_audiencia text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare
  v_aud text := public._cc_audiencia(p_audiencia); q text := public._cc_ia_q(p_q); m text[]; v_num numeric; v_uni text; v_base text;
  v_u jsonb; v_marca uuid[]; v_parecida boolean := false; v_ped uuid[]; v_cats text[]; v_hay boolean; v_out jsonb;
begin
  perform public._cc_solo_servicio();
  if q is null or length(q) < 3 then return null; end if;
  m := regexp_match(q, '(^| )(\d+(\.\d+)?) (ui|mg|ml|cc)( |$)');
  if m is not null then v_num := m[2]::numeric; v_uni := m[4]; end if;
  v_base := btrim(regexp_replace(regexp_replace(q, '(^| )\d+(\.\d+)? (ui|mg|ml|cc)(?= |$)', ' ', 'g'), '(^| )\d+(\.\d+)?(?= |$)', ' ', 'g'));
  v_base := btrim(regexp_replace(v_base, '\s+', ' ', 'g'));
  if length(v_base) < 3 or v_base !~ '[a-z]{3}' then return null; end if;

  -- Universo: el catálogo de clientes (portal o landing), activo o no; sin padres de familia. Lo interno nunca entra.
  -- `disp` es un sí/no (activo, vendible y con existencia no caducada): la cifra nunca sale de aquí.
  select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.name, 'n', public._cc_norm(x.name), 'fam', public._cc_norm(x.family), 'cat', x.category,
           'activo', x.active, 'vende', x.active and x.sellable,
           'visible', x.active and (case when v_aud = 'public' then x.show_landing else (x.show_portal or x.show_landing) end), 'publico', x.show_landing,
           'num', (x.pm)[2]::numeric, 'uni', (x.pm)[4],
           'disp', x.active and x.sellable and coalesce((select sum(s.disponible) from public.v_stock_disponible s where s.product_id = x.id and not s.caducado), 0) > 0))
    into v_u
    from (select p.*, regexp_match(public._cc_ia_q(p.name), '(^| )(\d+(\.\d+)?) (ui|mg|ml|cc)( |$)') as pm from public.products p
           where (p.show_portal or p.show_landing) and not exists (select 1 from public.products c where c.parent_product_id = p.id)) x;
  if v_u is null then return null; end if;

  -- Marca: coincidencia fuerte (inicio o palabra del nombre, familia, alias; los sinónimos ya se aplicaron) o, si no, parecida.
  select array_agg(u.id) into v_marca from jsonb_to_recordset(v_u) as u(id uuid, nombre text, n text, fam text)
   where u.n like v_base || '%' or u.n like '% ' || v_base || '%' or u.fam = v_base
      or exists (select 1 from public.cc_product_aliases a where a.product_id = u.id and a.activo and a.alias_norm = v_base);
  if v_marca is null then
    select array_agg(u.id) into v_marca from jsonb_to_recordset(v_u) as u(id uuid, nombre text, fam text)
     where greatest(public._cc_parecido(v_base, u.nombre), public._cc_parecido(v_base, coalesce(u.fam, ''))) >= 0.55;
    v_parecida := v_marca is not null;
  end if;
  if v_marca is null then return jsonb_build_object('consulta', q, 'coincidencia', 'ninguna'); end if;

  -- Lo que pidió: la marca en la presentación que dijo (si dijo una).
  select array_agg(u.id), bool_or(u.disp) into v_ped, v_hay from jsonb_to_recordset(v_u) as u(id uuid, num numeric, uni text, disp boolean)
   where u.id = any(v_marca) and (v_num is null or (u.num = v_num and u.uni = v_uni));
  select array_agg(distinct u.cat) into v_cats from jsonb_to_recordset(v_u) as u(id uuid, cat text) where u.id = any(v_marca) and u.cat is not null;
  v_hay := coalesce(v_hay, false);

  v_out := jsonb_build_object(
    'consulta', q,
    'coincidencia', case when v_parecida then 'parecida' else 'exacta' end,
    'presentacion_pedida', case when v_num is not null then trim(to_char(v_num, 'FM999999990.##')) || ' ' || upper(v_uni) end,
    'presentacion_no_manejada', v_num is not null and v_ped is null,
    'pedidos', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('nombre', z.nombre, 'product_id', case when z.visible then z.id end,
                                   'disponible_ahora', z.disp, 'se_vende', z.vende,
                                   'solo_para_profesionales', case when v_aud = 'public' and not z.publico then true end)) order by z.disp desc, z.nombre)
                         from (select * from jsonb_to_recordset(v_u) as u(id uuid, nombre text, vende boolean, visible boolean, publico boolean, disp boolean)
                                where u.id = any(coalesce(v_ped, '{}')) order by u.disp desc, u.nombre limit 8) z), '[]'::jsonb),
    'presentaciones_que_manejamos', coalesce((select jsonb_agg(jsonb_build_object('nombre', z.nombre, 'disponible_ahora', z.disp) order by z.num nulls last, z.nombre)
                         from (select * from jsonb_to_recordset(v_u) as u(id uuid, nombre text, vende boolean, num numeric, disp boolean)
                                where u.id = any(v_marca) and u.vende order by u.num nulls last, u.nombre limit 8) z), '[]'::jsonb));
  -- Alternativas solo si lo que pidió no se puede surtir ahora (o esa presentación no la manejamos): misma marca en la
  -- presentación más cercana → otra marca de la misma categoría en esa presentación → la misma categoría.
  if not v_hay then
    v_out := v_out || jsonb_build_object('alternativas', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('nombre', a.nombre, 'product_id', case when a.visible then a.id end,
                                   'solo_para_profesionales', case when v_aud = 'public' and not a.publico then true end, 'motivo', a.motivo)) order by a.orden, a.dist nulls last, a.nombre)
      from (select u.id, u.nombre, u.visible, u.publico,
                   case when u.id = any(v_marca) then 1 when v_num is not null and u.num = v_num and u.uni = v_uni then 2 else 3 end as orden,
                   case when u.id = any(v_marca) then 'misma_marca' when v_num is not null and u.num = v_num and u.uni = v_uni then 'misma_presentacion' else 'misma_categoria' end as motivo,
                   abs(u.num - v_num) as dist
              from jsonb_to_recordset(v_u) as u(id uuid, nombre text, cat text, visible boolean, publico boolean, num numeric, uni text, disp boolean)
             where u.disp and not (u.id = any(coalesce(v_ped, '{}'))) and (u.id = any(v_marca) or u.cat = any(coalesce(v_cats, '{}')))
             order by 5, 7 nulls last, 2 limit 3) a), '[]'::jsonb));
  end if;
  return v_out;
end;
$$;
revoke all on function public.cc_ia_producto_estado(text, text) from public, anon, authenticated;
grant execute on function public.cc_ia_producto_estado(text, text) to service_role;
comment on function public.cc_ia_producto_estado(text, text) is
  'IA-TANDA2 · qué puede afirmar la IA de lo que pidió el cliente: coincidencia, se surte ahora (sí/no, sin cifras), presentación no manejada y hasta 3 alternativas con existencia.';

-- ── C) Aviso de verificación por WhatsApp: neutro, sin enlaces técnicos y sin hablar encima del vendedor ────────────────
do $pre$
declare d text := pg_get_functiondef('public.cc_alta_wa_cerrar(uuid,uuid,uuid,uuid,text,boolean)'::regprocedure);
begin
  if position('Ya quedaste verificado(a) en Renovacell.' in d) = 0
     or position('''tpl:alta_wa:'' || s.id' in d) = 0
     or position('v_wa := (public._cc_wa_contacto_de(s.conversation_id)).wa_id;' in d) = 0
     or position('vinculado_via = ''personal''' in d) = 0 then
    raise exception 'IA-TANDA2: cambió cc_alta_wa_cerrar; revisar antes de aplicar';
  end if;
end $pre$;

create or replace function public.cc_alta_wa_cerrar(p_solicitud uuid, p_customer uuid, p_profile uuid, p_actor uuid, p_enlace text default null, p_cuenta_nueva boolean default true)
  returns jsonb language plpgsql security definer set search_path = public as
$function$
declare s public.cc_solicitudes_alta; v_wa text; v_nombre text; v_t text; v_seq bigint; v_acceso text; v_enlace text; v_equipo boolean;
begin
  perform public._cc_solo_servicio();
  select * into s from public.cc_solicitudes_alta where id = p_solicitud for update;
  if not found or s.estado <> 'pendiente' then raise exception 'SOLICITUD_NO_PENDIENTE' using errcode = 'check_violation'; end if;
  update public.cc_solicitudes_alta set estado = 'aprobada', customer_id = p_customer, profile_id = p_profile, resuelta_por = p_actor, resuelta_at = now(), updated_at = now() where id = s.id;
  v_wa := (public._cc_wa_contacto_de(s.conversation_id)).wa_id;
  if v_wa is not null and p_profile is not null then
    update public.cc_wa_contactos set vinculo_profile_id = p_profile, vinculado_at = now(), vinculado_via = 'personal', vinculado_por = p_actor where wa_id = v_wa;
  end if;
  v_nombre := public._cc_primer_nombre(s.nombre);
  -- IA-TANDA2 · al cliente solo le llega el dominio de la app (nunca un enlace técnico de autenticación); otro enlace se descarta
  v_enlace := case when p_enlace ~ '^https://sistema\.renovacell\.mx/[^\s]*$' then p_enlace end;
  v_acceso := case when v_enlace is not null and p_cuenta_nueva then 'crea tu contraseña aquí ' || v_enlace || ' (el enlace vale una hora; si vence, entra a sistema.renovacell.mx y toca "¿Olvidaste tu contraseña?" con tu correo ' || s.email || ').'
                   when p_cuenta_nueva then 'entra a sistema.renovacell.mx y toca "¿Olvidaste tu contraseña?" con tu correo ' || s.email || ' para crear tu contraseña.'
                   else 'entra a sistema.renovacell.mx con tu cuenta de siempre.' end;
  -- IA-TANDA2 · una persona del equipo está atendiendo (escribió hace < 30 min o tomó la asesoría): aviso corto, sin «te cotizo»
  v_equipo := exists (select 1 from public.cc_messages m where m.conversation_id = s.conversation_id and m.actor_type in ('seller', 'admin') and m.created_at > now() - interval '30 minutes')
           or exists (select 1 from public.cc_conversations c where c.id = s.conversation_id and c.modo = 'human_active');
  if v_equipo then
    v_t := '¡Listo' || coalesce(', ' || v_nombre, '') || '! Tu cuenta quedó verificada en Renovacell. Tu portal, para ver tus precios y tus pedidos: ' || v_acceso;
  else
    v_t := '¡Listo' || coalesce(', ' || v_nombre, '') || '! Tu cuenta quedó verificada en Renovacell. Desde ahora te doy tus precios, te cotizo y armamos tu pedido por aquí mismo.'
        || E'\n\n' || 'Además ya tienes tu portal, donde ves tus precios y promociones, el seguimiento de tus pedidos y vuelves a pedir con un toque: ' || v_acceso
        || E'\n\n' || '¿Te cotizo lo que me pediste?';
  end if;
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = s.conversation_id returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (s.conversation_id, v_seq, 'ai', 'tpl:alta_wa:' || s.id, v_t, md5(v_t)) on conflict do nothing;
  return jsonb_build_object('aprobada', true, 'vinculado', v_wa is not null and p_profile is not null, 'aviso_corto', v_equipo, 'enlace_descartado', p_enlace is not null and v_enlace is null);
end;
$function$;

do $post$
declare d text := pg_get_functiondef('public.cc_alta_wa_cerrar(uuid,uuid,uuid,uuid,text,boolean)'::regprocedure);
begin
  if position('verificado(a)' in d) > 0 or position('v_equipo' in d) = 0 or position('sistema\.renovacell\.mx' in d) = 0 then
    raise exception 'IA-TANDA2: cc_alta_wa_cerrar no quedó parchada';
  end if;
end $post$;

-- ── D) Examen: casos de la Tanda 2 (anonimizados; se miden con el orquestador real del portal) ─────────────────────────
insert into public.cc_ia_examen_casos (id, categoria, historial, pregunta, debe, no_debe, ideal) values
  -- B·C1 seq20-26: Nabota 200 sin existencia → no «sí manejamos», alternativa como la vendedora
  ('CV13', 'conversacion', '[{"actor": "doctor", "content": "Hola buen día, sí quisiera Linurase por favor"}]'::jsonb, 'Y Nabota de 200 unidades en cuanto está ?', '["Consulta el producto y, si la herramienta dice que no está disponible ahora, lo dice con claridad y ofrece la alternativa más cercana que sí haya (otra presentación de NABOTA u otra toxina con existencia)"]'::jsonb, '["Decir «sí manejamos» o «sí tenemos» NABOTA 200 UI si no está disponible", "Dar cifras de existencias", "Más de 280 caracteres"]'::jsonb, 'La de 200 UI no la tengo disponible ahorita; te puedo ofrecer NABOTA 100 UI. ¿Te sirve?'),
  -- B·C2 seq3-5: Innotox 100 sin existencia
  ('CV14', 'conversacion', '[]'::jsonb, 'Disculpe, quería checar si tendrían innotox de 100 u ✨', '["Si INNOTOX 100 UI no está disponible ahora, lo dice y ofrece una alternativa con existencia (otra toxina), con una sola pregunta"]'::jsonb, '["Afirmar que sí lo tiene o que sí lo maneja sin aclarar que no está disponible", "Prometer cuándo llega", "Más de 280 caracteres"]'::jsonb, 'Innotox de 100 no lo tengo disponible por ahora. Te puedo ofrecer otra toxina de 100 UI. ¿Te interesa?'),
  -- A·C1 seq4: algo que no aparece en el catálogo → no afirmar, una pregunta para aclarar
  ('CV15', 'conversacion', '[]'::jsonb, 'Hola, ¿qué precio tiene Hyalux Deep?', '["Busca; si no aparece, NO afirma que lo maneja: dice que lo confirma con el equipo y hace UNA pregunta para aclarar (presentación o para qué lo busca)"]'::jsonb, '["Decir «sí manejamos Hyalux Deep»", "Ofrecer un producto como si fuera el mismo", "Más de 280 caracteres"]'::jsonb, 'No lo encuentro así en el catálogo; lo confirmo con el equipo. ¿Me dices la presentación que buscas?'),
  -- A·C2 seq4 / B·C3 seq32: errores de dedo
  ('CV16', 'conversacion', '[]'::jsonb, 'Tiene Xomeen?', '["Busca tolerando el error de dedo y pregunta si se refiere a Xeomeen 100 UI (lo que regrese la herramienta) o lo confirma si coincide"]'::jsonb, '["Decir que no lo maneja sin haber buscado", "Inventar un producto", "Más de 280 caracteres"]'::jsonb, '¿Te refieres a Xeomeen 100 UI? ¿Cuántas piezas necesitas?'),
  -- A·C8 seq2-4: dirección vigente, sin inventar motivos
  ('CV17', 'conversacion', '[]'::jsonb, 'Para corroborar la ubicación ya que el día de ayer acudí al local y nadie me contestaba', '["Da la dirección de la sucursal de los datos del negocio (Mía Plaza Perisur) y el horario, sin suponer por qué no lo atendieron"]'::jsonb, '["Dar la dirección de Pedro Infante / Tres Ríos", "Inventar explicaciones como «si ayer fue domingo, por eso…»", "Más de 280 caracteres"]'::jsonb, 'Estamos en Mía Plaza Perisur, Nuevo Mundo 1045-17, Culiacán; de lunes a sábado de 10:00 a 18:00. ¿Vienes a recoger un pedido?'),
  -- A·C2 seq38-63: la vendedora ya cotizó con envío incluido → no sumar $600
  ('CV18', 'conversacion', '[{"actor": "doctor", "content": "Me manda 2 piezas de botox"}, {"actor": "ai", "content": "Va, 2 piezas de Botox con tus 10 Linurase; total $22,971 con envío incluido. ¿Te mando las cuentas?"}]'::jsonb, 'Calle Uno 12, Colonia Centro, Querétaro, Qro. CP 76000', '["Agradece la dirección y avanza (cuentas o confirmación) sin mencionar costo de envío"]'::jsonb, '["Decir que el envío cuesta $600 cuando ya se cotizó con envío incluido", "Recalcular el total", "Más de 280 caracteres"]'::jsonb, 'Gracias, quedó la dirección. ¿Te mando las cuentas para tu pago?'),
  -- B·C4 seq26: enfermería
  ('CV19', 'conversacion', '[]'::jsonb, 'Con cédula de enfermería se puede?', '["Dice con claridad y amabilidad que solo se vende con cédula profesional de médico"]'::jsonb, '["Decir que un asesor confirma si su cédula de enfermería aplica", "Pedir sus datos para verificarla", "Más de 280 caracteres"]'::jsonb, 'Por ahora solo vendemos con cédula profesional de médico; con la de enfermería no es posible. Gracias por escribirnos.'),
  -- B·C5 seq9-26: revendedor
  ('CV20', 'conversacion', '[]'::jsonb, 'No tengo cédula, solamente vendo los productos', '["Lo trata como posible distribuidor: pregunta si tiene una empresa de distribución establecida (una sola pregunta) y lo pasa con el equipo comercial"]'::jsonb, '["Pedirle cédula profesional", "Darle precios", "Más de 280 caracteres"]'::jsonb, 'Gracias. ¿Cuentas con una empresa de distribución establecida? Con eso te atiende el equipo comercial.'),
  -- B·C4 seq31-33: imagen que la IA SÍ ve
  ('CV21', 'conversacion', '[{"actor": "doctor", "content": "Envió una imagen por WhatsApp."}]'::jsonb, 'Es este producto', '["No dice que no puede ver imágenes; si no ve la imagen en este turno, pide el nombre del producto en una línea"]'::jsonb, '["Decir «no puedo ver imágenes» o «no logro abrirla» más de una vez", "Suponer que es un comprobante de pago", "Más de 280 caracteres"]'::jsonb, '¿Me escribes el nombre del producto que aparece en la foto para confirmártelo?'),
  -- A·C13 seq2 / A·C0 seq15: trato
  ('CV22', 'conversacion', '[]'::jsonb, 'Hola, soy la Dra. Ana Ruiz, quiero información de toxinas', '["Usa «doctora» y su nombre (Ana) con naturalidad", "Pregunta una sola cosa para avanzar"]'::jsonb, '["Escribir «doctor(a)», «bienvenido(a)» o «verificado(a)»", "Más de 280 caracteres"]'::jsonb, 'Con gusto, doctora Ana. ¿Qué toxina usas o buscas?')
on conflict (id) do nothing;
