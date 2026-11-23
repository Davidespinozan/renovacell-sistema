-- 0772 down: sin «obvio» ni fusión en un clic (clientes_duplicados vuelve a la versión 0771).
drop function if exists public.clientes_fusionar_obvios();
create or replace function public.clientes_duplicados(p_limite integer default 60)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    with k as (
      select c.id, 'telefono' as tipo, public._c360_tel_norm(c.phone) as v from public.customers c where c.active and length(public._c360_tel_norm(c.phone)) = 10
      union select ph.customer_id, 'telefono', ph.numero_norm from public.customer_phones ph join public.customers c on c.id = ph.customer_id and c.active where ph.activo and length(ph.numero_norm) = 10
      union select c.id, 'correo', lower(btrim(c.email)) from public.customers c where c.active and nullif(btrim(coalesce(c.email, '')), '') is not null
      union select c.id, 'cedula', regexp_replace(c.meta ->> 'cedula', '[^0-9]', '', 'g') from public.customers c where c.active and length(regexp_replace(coalesce(c.meta ->> 'cedula', ''), '[^0-9]', '', 'g')) >= 5
    ),
    g as (select tipo, v, array_agg(distinct id order by id) as ids from k group by tipo, v having count(distinct id) > 1),
    g2a as (select ids, array_agg(distinct tipo order by tipo) as por from g group by ids),
    -- REPETIDOS-NOMBRE (0771, dueño): si SOLO comparten teléfono, cuentan solo las fichas cuyo nombre se parece al de otra
    -- del grupo (comparten un nombre o apellido); sin nada más en común son personas distintas (consultorio o número de la
    -- familia compartido). Si comparten CORREO o CÉDULA se agrupan siempre: ahí un nombre distinto es error de captura.
    g2b as (select case when 'cedula' = any (g2a.por) or 'correo' = any (g2a.por) then g2a.ids else array(
                select x.id from unnest(g2a.ids) as x(id) join public.customers cx on cx.id = x.id
                 where exists (select 1 from unnest(g2a.ids) as y(id) join public.customers cy on cy.id = y.id
                                where y.id <> x.id and public._nombre_palabras(cx.full_name) && public._nombre_palabras(cy.full_name))
                 order by x.id) end as ids, g2a.por from g2a),
    g2 as (select ids, por from g2b where cardinality(ids) > 1),
    g3 as (select * from g2 where exists (select 1 from unnest(g2.ids) as x(ida), unnest(g2.ids) as y(idb) where x.ida < y.idb
                                            and not exists (select 1 from public.clientes_no_duplicados nd where nd.a = x.ida and nd.b = y.idb))),
    det as (
      select g3.ids, g3.por, jsonb_agg(jsonb_build_object(
          'id', c.id, 'nombre', c.full_name, 'correo', c.email,
          'telefono', coalesce((select ph.numero from public.customer_phones ph where ph.customer_id = c.id and ph.activo and ph.es_principal limit 1), c.phone),
          'ciudad', c.city, 'origen', c.source, 'portal', c.profile_id is not null, 'cedula', nullif(c.meta ->> 'cedula', '') is not null,
          'vendedor', public._cc_nombre_personal(public._cc_vendedor_de_cliente(c.id)),
          'pedidos', (select count(*) from public.orders o where o.customer_id = c.id and o.status <> 'cancelled'),
          'total', (select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = c.id and o.status <> 'cancelled'),
          'creado', c.created_at)
          order by (c.profile_id is not null) desc, (select count(*) from public.orders o where o.customer_id = c.id) desc, c.created_at) as fichas,
        sum((select count(*) from public.orders o where o.customer_id = c.id)) as peso
      from g3 join public.customers c on c.id = any (g3.ids) group by g3.ids, g3.por)
    select jsonb_agg(jsonb_build_object('ids', to_jsonb(ids), 'por', to_jsonb(por), 'fichas', fichas) order by peso desc, cardinality(ids))
    from (select * from det order by peso desc limit greatest(1, least(coalesce(p_limite, 60), 300))) z), '[]'::jsonb);
end;
$f$;


drop function if exists public._grupo_obvio(jsonb);
drop function if exists public._nombres_obvios(text, text);
drop function if exists public._nombre_contenido(text[], text[]);
