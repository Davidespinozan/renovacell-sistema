-- R4-B2 · baja B2-4 (lecturas del panel), B2-3b, B2-2, B2-3a y B2-1 (orden inverso) para cadenas que bajan/reaplican migraciones de canal (167–170).
-- Solo dentro de la transacción de prueba (que termina en rollback): el down de B2-2 se niega con mensajes retenidos,
-- inciertos o descartados (protección de producción), así que aquí se neutralizan antes.
update public.cc_wa_salida set estado = 'fallido' where estado in ('retenido', 'incierto', 'descartado');
update public.cc_meta_salida set estado = 'fallido' where estado in ('retenido', 'incierto', 'descartado');
\ir ../../../../rollback/panel_canal/99_down.sql
\ir ../../../../rollback/exclusividad_toma/99_down.sql
\ir ../../../../rollback/cola_salida_segura/99_down.sql
\ir ../../../../rollback/ia_primero_enrutamiento/99_down.sql
\ir ../../../../rollback/canal_controles/99_down.sql
