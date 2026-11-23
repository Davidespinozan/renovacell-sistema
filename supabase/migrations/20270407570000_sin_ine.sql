-- SIN-INE (23 nov 2026, dueño: «también hay que quitar el INE para verificación, ya no lo vamos a pedir»).
-- La verificación del doctor es solo con su cédula (la revisa una persona). Aquí:
--   · mi_verificacion ya no lista las fotos de la INE como faltantes (antes el portal decía «nos falta tu INE»);
--   · los avisos a la vendedora / Dirección ya no dicen «revisa su cédula y su INE».
-- La evidencia de INE que ya existe se conserva (la ficha la sigue mostrando a quien revisa).
do $m$
declare v text; f text;
begin
  v := pg_get_functiondef('public.mi_verificacion()'::regprocedure);
  if position($$case when not ev ? 'ine-front' then 'ine-front' end,$$ in v) = 0 then raise exception 'SIN-INE: mi_verificacion no es la esperada'; end if;
  v := replace(v, $$        case when not ev ? 'ine-front' then 'ine-front' end,
        case when not ev ? 'ine-back' then 'ine-back' end], null)));$$, $$], null)));$$);
  v := replace(v, $$case when nullif(btrim(coalesce(p.meta ->> 'cedula', '')), '') is null then 'cedula' end,$$, $$case when nullif(btrim(coalesce(p.meta ->> 'cedula', '')), '') is null then 'cedula' end$$);
  execute v;
  foreach f in array array['verificacion_avisar', '_verif_reparto_asignar'] loop
    select pg_get_functiondef(p.oid) into v from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if v is null or position('su INE' in v) = 0 then raise exception 'SIN-INE: % no es la esperada', f; end if;
    execute replace(v, ' y su INE', '');
  end loop;
end $m$;
