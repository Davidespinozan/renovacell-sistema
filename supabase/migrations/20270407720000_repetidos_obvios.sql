-- REPETIDOS OBVIOS (23 nov 2026, dueño: «es evidente que Tere Salas y María Teresa Salas son la misma persona»).
-- Un grupo es OBVIO si, además de compartir teléfono, correo o cédula, en cada par de fichas el nombre corto está CONTENIDO
-- en el largo (cada palabra del corto es una palabra del largo o su inicio de 3+ letras): «Tere Salas» ⊂ «María Teresa
-- Salas Hernández». No es obvio «Julio César Quintero» / «Julio César Silva» (otro apellido) ni «Gina» / «Georgina».
-- Tampoco si hay dos cuentas del portal o pedidos en más de una ficha. Al 23 nov: 17 de 52 grupos.
--   · clientes_duplicados(): cada grupo trae «obvio».
--   · clientes_fusionar_obvios(): Dirección los fusiona en un clic (se queda la de pedidos; si no, la del portal; si no,
--     la más antigua), con las mismas reglas y bitácora que la fusión manual.

create or replace function public._nombre_contenido(p_corto text[], p_largo text[])
returns boolean language sql immutable as $f$
  select cardinality(p_corto) > 0 and not exists (select 1 from unnest(p_corto) x
    where not exists (select 1 from unnest(p_largo) y where y = x or (length(x) >= 3 and y like x || '%')))
$f$;

create or replace function public._nombres_obvios(a text, b text)
returns boolean language sql immutable as $f$
  select case when cardinality(public._nombre_palabras(a)) <= cardinality(public._nombre_palabras(b))
              then public._nombre_contenido(public._nombre_palabras(a), public._nombre_palabras(b))
              else public._nombre_contenido(public._nombre_palabras(b), public._nombre_palabras(a)) end
$f$;

create or replace function public._grupo_obvio(p_fichas jsonb)
returns boolean language sql immutable as $f$
  select not exists (select 1 from jsonb_array_elements(p_fichas) f1, jsonb_array_elements(p_fichas) f2
                      where f1 ->> 'id' < f2 ->> 'id' and not public._nombres_obvios(f1 ->> 'nombre', f2 ->> 'nombre'))
     and (select count(*) from jsonb_array_elements(p_fichas) f where (f ->> 'portal')::boolean) <= 1
     and (select count(*) from jsonb_array_elements(p_fichas) f where (f ->> 'pedidos')::int > 0) <= 1
$f$;

do $m$
declare v text := pg_get_functiondef('public.clientes_duplicados(integer)'::regprocedure);
  viejo text := $q$select jsonb_agg(jsonb_build_object('ids', to_jsonb(ids), 'por', to_jsonb(por), 'fichas', fichas) order by peso desc, cardinality(ids))$q$;
begin
  if position(viejo in v) = 0 then raise exception 'OBVIOS: clientes_duplicados no es la esperada'; end if;
  execute replace(v, viejo, $q$select jsonb_agg(jsonb_build_object('ids', to_jsonb(ids), 'por', to_jsonb(por), 'fichas', fichas, 'obvio', public._grupo_obvio(fichas)) order by peso desc, cardinality(ids))$q$);
end $m$;

create or replace function public.clientes_fusionar_obvios()
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare g jsonb; q uuid; v_van uuid[]; n int := 0; hechos jsonb := '[]'::jsonb;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  for g in select e from jsonb_array_elements(public.clientes_duplicados(300)) e where (e ->> 'obvio')::boolean loop
    -- se queda: la de pedidos; si no, la del portal; si no, la más antigua
    select (f ->> 'id')::uuid into q from jsonb_array_elements(g -> 'fichas') f
     order by ((f ->> 'pedidos')::int > 0) desc, (f ->> 'portal')::boolean desc, (f ->> 'creado') asc limit 1;
    select array_agg((f ->> 'id')::uuid) into v_van from jsonb_array_elements(g -> 'fichas') f where (f ->> 'id')::uuid <> q;
    perform public.clientes_fusionar(q, v_van, 'Repetido obvio: un nombre contiene al otro');
    n := n + 1;
    hechos := hechos || jsonb_build_object('queda', q, 'nombre', (select full_name from public.customers where id = q), 'fusionadas', cardinality(v_van));
  end loop;
  return jsonb_build_object('grupos', n, 'detalle', hechos);
end;
$f$;

revoke all on function public._nombre_contenido(text[], text[]), public._nombres_obvios(text, text), public._grupo_obvio(jsonb),
  public.clientes_fusionar_obvios() from public, anon, authenticated;
grant execute on function public.clientes_fusionar_obvios() to authenticated;
