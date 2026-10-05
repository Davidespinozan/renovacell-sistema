-- W5 · RELOJ DEL NEGOCIO. Una sola semántica de día: America/Mazatlan.
--
-- La tabla de VECTORES de este archivo es la prueba de equivalencia entre el servidor y
-- el navegador: aquí la ejecuta Postgres (`dia_negocio`) y en
-- apps/web/src/data/periodo.equivalencia.test.ts la ejecuta el frontend (`diaNegocio`)
-- leyendo ESTE MISMO archivo. Si un lado cambia de zona o de regla, una de las dos falla.
begin;
do $t$
declare r record; v_n int := 0; v_mal int;
begin
  for r in select * from (values
    -- VECTORES:INICIO
    ('2026-11-01T06:30:00Z'::timestamptz, '2026-10-31'::date, '23:30 del ultimo dia del mes: sigue siendo octubre'),
    ('2026-11-01T06:59:59Z'::timestamptz, '2026-10-31'::date, 'ultimo segundo del mes'),
    ('2026-11-01T07:00:00Z'::timestamptz, '2026-11-01'::date, 'primer instante del mes siguiente'),
    ('2026-10-06T00:00:00Z'::timestamptz, '2026-10-05'::date, '17:00 locales: el corte por UTC lo mandaria al dia 6'),
    ('2026-10-05T23:59:59Z'::timestamptz, '2026-10-05'::date, 'tarde local, mismo dia en UTC'),
    ('2026-10-05T06:59:59Z'::timestamptz, '2026-10-04'::date, 'borde de dia: 23:59:59 del dia anterior'),
    ('2026-10-05T07:00:00Z'::timestamptz, '2026-10-05'::date, 'borde de dia: medianoche local'),
    ('2027-01-01T06:59:59Z'::timestamptz, '2026-12-31'::date, 'borde de anio: todavia es 31 de diciembre'),
    ('2027-01-01T07:00:00Z'::timestamptz, '2027-01-01'::date, 'borde de anio: anio nuevo'),
    ('2028-03-01T06:30:00Z'::timestamptz, '2028-02-29'::date, 'anio bisiesto'),
    ('2026-10-31T23:30:00-07:00'::timestamptz, '2026-10-31'::date, 'instante escrito con desfase explicito'),
    ('2026-10-31T23:30:00+09:00'::timestamptz, '2026-10-31'::date, 'capturado desde Tokio: 07:30 locales del mismo dia'),
    ('2021-07-01T05:59:59Z'::timestamptz, '2021-06-30'::date, 'historico con horario de verano (UTC-6): aun 30 de junio'),
    ('2021-07-01T06:00:00Z'::timestamptz, '2021-07-01'::date, 'historico con horario de verano: medianoche local'),
    ('2021-07-01T06:30:00Z'::timestamptz, '2021-07-01'::date, 'un desfase fijo de -7 lo mandaria al 30 de junio'),
    ('2021-12-01T06:30:00Z'::timestamptz, '2021-11-30'::date, 'historico en horario normal (UTC-7)')
    -- VECTORES:FIN
  ) t(ts, dia, nota) loop
    perform tests.eq(public.dia_negocio(r.ts), r.dia, 'dia_negocio · ' || r.nota);
    v_n := v_n + 1;
  end loop;
  perform tests.ok(v_n >= 16, 'se ejecutaron todos los vectores');

  -- hoy_local() (W1) y dia_negocio() son la MISMA definición.
  perform tests.eq(public.hoy_local(), public.dia_negocio(now()), 'hoy_local() = dia_negocio(now())');
  perform tests.ok(position('America/Mazatlan' in pg_get_functiondef('public.hoy_local()'::regprocedure)) > 0
               and position('America/Mazatlan' in pg_get_functiondef('public.dia_negocio(timestamptz)'::regprocedure)) > 0,
    'las dos cortan en America/Mazatlan');

  -- El servidor corre en UTC (como producción): el día del negocio NO depende de eso.
  perform tests.eq(current_setting('TimeZone'), 'UTC', 'el cluster de pruebas corre en UTC, igual que producción');
  set local timezone = 'Asia/Tokyo';
  perform tests.eq(public.dia_negocio('2026-11-01T06:30:00Z'::timestamptz), '2026-10-31'::date,
    'con la sesión en otra zona horaria el día del negocio no cambia');
  set local timezone = 'UTC';

  -- Rango por instantes ⇔ comparación por día. Es lo que permite usar el índice de
  -- created_at sin cambiar el resultado. Se barre cada 53 minutos, incluidos los
  -- cambios de horario históricos (2021–2022) y los bordes de mes y de año.
  select count(*) into v_mal
    from generate_series('2021-03-01T00:00:00Z'::timestamptz, '2023-01-15T00:00:00Z'::timestamptz, interval '53 minutes') g(ts)
    cross join (values ('2021-04-04'::date, '2021-04-04'::date), ('2021-10-31', '2021-10-31'),
                       ('2022-04-03', '2022-04-03'), ('2022-10-30', '2022-10-30'),
                       ('2021-06-01', '2021-06-30'), ('2022-12-01', '2022-12-31')) p(d1, d2)
   where (public.dia_negocio(g.ts) between p.d1 and p.d2)
         is distinct from (g.ts >= public._kpi_inicio(p.d1) and g.ts < public._kpi_inicio(p.d2 + 1));
  perform tests.eq(v_mal, 0, 'rango [inicio(desde), inicio(hasta+1)) ⇔ dia_negocio entre desde y hasta (con cambios de horario históricos)');

  select count(*) into v_mal
    from generate_series('2026-08-25T00:00:00Z'::timestamptz, '2027-01-05T00:00:00Z'::timestamptz, interval '7 minutes') g(ts)
    cross join (values ('2026-10-01'::date, '2026-10-31'::date), ('2026-10-31', '2026-10-31'),
                       ('2026-11-01', '2026-11-01'), ('2026-12-31', '2026-12-31'), ('2027-01-01', '2027-01-01')) p(d1, d2)
   where (public.dia_negocio(g.ts) between p.d1 and p.d2)
         is distinct from (g.ts >= public._kpi_inicio(p.d1) and g.ts < public._kpi_inicio(p.d2 + 1));
  perform tests.eq(v_mal, 0, 'la misma equivalencia en bordes de día, mes y año de 2026–2027');
end $t$;
rollback;
