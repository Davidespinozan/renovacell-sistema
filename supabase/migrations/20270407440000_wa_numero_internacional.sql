-- WHATSAPP A NÚMEROS DEL EXTRANJERO (21 nov 2026: «David Espinoza tiene un número americano… sale que no tiene un número de
-- 10 dígitos»). «Escribir a un cliente» y «Nuevo prospecto» solo aceptaban celulares de México. Ahora también con lada
-- internacional (p. ej. +1 737 …): México sigue igual (10 dígitos → 521…); otro país = número completo con su lada.

-- wa_id con el que se le escribe a un cliente (o null si su ficha no tiene un celular usable).
create or replace function public._wa_id_de_digitos(d text) returns text language sql immutable as $$
  select case
    when length(d) = 10 then '521' || d                                   -- México a 10 dígitos
    when length(d) = 12 and d like '52%' then '521' || right(d, 10)        -- +52 …
    when length(d) = 13 and d like '521%' then d                           -- +52 1 …
    when length(d) between 11 and 15 and d not like '52%' and d !~ '^0' then d   -- otro país con su lada (+1 …)
  end;
$$;

create or replace function public._wa_id_cliente(p_customer uuid) returns text language sql stable security definer set search_path to 'public' as $$
  select public._wa_id_de_digitos(regexp_replace(coalesce(
    (select t.numero from public.customer_phones t where t.customer_id = p_customer and t.activo and nullif(btrim(t.numero), '') is not null order by t.es_principal desc, t.created_at limit 1),
    (select c.phone from public.customers c where c.id = p_customer), ''), '\D', '', 'g'));
$$;

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.cc_wa_escribir_cliente(uuid,text,uuid)'::regprocedure);
  if position('v_tel := public._difwa_tel(p_customer);' in d) = 0
     or position('where right(w.wa_id, 10) = v_tel order by' in d) = 0
     or position('values (''521'' || v_tel, left(' in d) = 0
     or position('where wa_id = ''521'' || v_tel;' in d) = 0 then raise exception 'WA-INTL: cambió cc_wa_escribir_cliente'; end if;
  d := replace(d, 'v_tel := public._difwa_tel(p_customer);', 'v_tel := public._wa_id_cliente(p_customer);   -- WA-INTL · wa_id completo (México 521…, extranjero con su lada)');
  d := replace(d, 'este cliente no tiene un celular de 10 dígitos en su ficha', 'este cliente no tiene un celular válido en su ficha (10 dígitos en México, o con su lada si es del extranjero, p. ej. +1 …)');
  d := replace(d, 'where right(w.wa_id, 10) = v_tel order by', 'where (case when v_tel like ''521%'' then w.wa_id like ''52%'' and right(w.wa_id, 10) = right(v_tel, 10) else w.wa_id = v_tel end) order by');
  d := replace(d, 'values (''521'' || v_tel, left(', 'values (v_tel, left(');
  d := replace(d, 'where wa_id = ''521'' || v_tel;', 'where wa_id = v_tel;');
  execute d;

  d := pg_get_functiondef('public.cliente_prospecto_crear(text,text,text,text,text)'::regprocedure);
  if position('if length(v_dig) <> 10 then raise exception ''CELULAR_INVALIDO: escribe el celular a 10 dígitos''' in d) = 0
     or position('right(regexp_replace(coalesce(c.phone, ''''), ''\D'', '''', ''g''), 10) = v_dig' in d) = 0 then raise exception 'WA-INTL: cambió cliente_prospecto_crear'; end if;
  d := replace(d, 'if length(v_dig) <> 10 then raise exception ''CELULAR_INVALIDO: escribe el celular a 10 dígitos''',
    'if public._wa_id_de_digitos(v_dig) is null then raise exception ''CELULAR_INVALIDO: escribe el celular a 10 dígitos (México) o con su lada si es del extranjero (p. ej. +1 737 …)''');
  d := replace(d, 'v_tel := v_dig;', 'v_tel := case when length(v_dig) = 10 then v_dig else ''+'' || v_dig end;   -- WA-INTL · extranjero con su lada');
  d := replace(d, 'right(regexp_replace(coalesce(c.phone, ''''), ''\D'', '''', ''g''), 10) = v_dig',
    'public._wa_id_de_digitos(regexp_replace(coalesce(c.phone, ''''), ''\D'', '''', ''g'')) = public._wa_id_de_digitos(v_dig)');
  execute d;
end $patch$;

do $post$ begin
  if position('_wa_id_cliente' in pg_get_functiondef('public.cc_wa_escribir_cliente(uuid,text,uuid)'::regprocedure)) = 0
     or position('_wa_id_de_digitos' in pg_get_functiondef('public.cliente_prospecto_crear(text,text,text,text,text)'::regprocedure)) = 0 then
    raise exception 'WA-INTL: no quedó aplicada'; end if;
end $post$;
