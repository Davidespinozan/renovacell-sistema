# Mejoras operativas para Renovacell (aprendidas de sala-studio)

sala-studio lleva meses en operación real (SaaS de gimnasios multi-tenant) y ya resolvió
los flujos del día a día que solo salen a la luz con clientes reales: **corte de caja,
recibos, PDFs, import/export y reportes**. Este documento compara qué tiene Renovacell hoy
vs. lo que sala resolvió, y prioriza qué traer.

> Contexto: Renovacell es B2B (distribución médica a doctores), no un POS de gimnasio.
> Algunos patrones migran tal cual; otros se adaptan (ej. "socio en riesgo" → "doctor que
> dejó de pedir"). Lo específico de gym (heatmap de clases, no-shows, cohortes de
> membresía) NO aplica.

## Tabla comparativa

| Flujo | Renovacell hoy | sala-studio | Qué robar |
|---|---|---|---|
| **Corte de caja** | esperado vs contado + motivo + historial (`CierreCaja.tsx`) | rango de fechas, preview server-side, ticket imprimible, snapshot histórico, Devolver/Corregir | ticket imprimible + rango + total en letra + append-only |
| **Devoluciones/correcciones** | (no existe) | reembolso = fila negativa `revierte_pago_id`; distingue "devolución al cliente" vs "corrección de error"; parcial con tope; motivo obligatorio | **el flujo completo** (era el hueco) |
| **Recibo de venta (POS)** | no imprime ticket al cliente (`Caja.tsx`) | recibo con folio, datos fiscales, "No es CFDI", print + compartir PNG | ticket de venta imprimible |
| **PDF/impresión** | `jspdf-autotable` (tablas) + `window.print()` en Recibo de entrega | `window.print()` + portal a `<body>` + `@media print` (descartaron html2canvas) | patrón print para documentos + fix "chueco" + limpieza `afterprint` |
| **Exportación** | **.xlsx (exceljs) + PDF** ✅ (ventaja) | solo CSV, pero con BOM/escape/CRLF puro y testeado | motor CSV robusto (BOM UTF-8 → acentos en Excel) |
| **Importación** | 4 entidades, preview, sinónimos (`Importar.tsx`) | wizard + errores por fila + "descargar no importados" + idempotencia en BD + batching | reporte de rechazos + idempotencia (`BEGIN/EXCEPTION` por fila) |
| **Reportes** | KPIs + recharts (estilo sala-studio) | cobrado real vs proyección, clientes en riesgo, PDF por print | "cobrado real vs proyección" + "doctores en riesgo" |

## Principios de fondo (lo más valioso)

1. **Ledger append-only como fuente de verdad.** Los cobros nunca se editan ni borran; una
   devolución/corrección es *otra fila negativa* que apunta al original (`revierte_pago_id`).
   Un trigger `BEFORE UPDATE OR DELETE` bloquea ediciones. Resultado: "el ingreso del mes
   pasado es el mismo hoy que dentro de un año". El corte de caja no mueve dinero: solo
   fotografía un `SUM` vs conteo físico.
2. **Toda escritura de dinero por RPC `SECURITY DEFINER`, cero INSERT policy.** El cliente
   solo lee (RLS); el servidor **recalcula el esperado** (nunca confía en el número del
   cliente). Concurrencia con `pg_advisory_xact_lock`. Errores tipados `CÓDIGO: mensaje`
   que el front traduce.
3. **Dinero siempre en centavos enteros** (nunca float: "un float en dinero termina en
   descuadres de un centavo que nadie encuentra").
4. **Documentos = una sola plantilla como fuente de verdad**, idéntica en pantalla, print y
   link público, alimentada por función backend con token firmado.

## Patrón de impresión (reemplaza html2canvas para documentos)

sala **descartó jspdf+html2canvas** porque html2canvas se rompe con CSS moderno
(`color-mix`, gradientes, fuentes, gráficas). Patrón que adoptaron:

- La plantilla se monta como **portal a `document.body`** (`createPortal`), `display:none` en pantalla.
- Un helper agrega una clase al `<body>` (`printing-corte`) y llama `window.print()`.
- `@media print` oculta **todo** con `display:none` salvo el portal → una sola hoja limpia.
- La clase se limpia en `afterprint`/`focus`, **nunca por `setTimeout`** (un timer reintroduce
  la app a mitad del diálogo → hojas en blanco).
- **Fix "PDF chueco"** (salía corrido a la derecha): un ancestro `position:relative` (el
  sidebar de 240px) desplazaba el `position:absolute` del contenido. Solución: en
  `@media print`, forzar `position:static` a ese ancestro.

> Renovacell ya usa `window.print()` en el Recibo de entrega y `jspdf-autotable` (que dibuja
> tablas directo, sin html2canvas → OK). El riesgo solo aparece si en algún momento generan
> PDF de una vista estilizada con html2canvas: ahí conviene el patrón print.

## Import robusto (relevante para la migración Odoo)

- **Motor CSV puro y testeado**: BOM `U+FEFF` (acentos en Excel), CRLF, escape de comillas/comas.
- **Idempotencia real en BD**: RPC con loop `FOR ... LOOP` + `BEGIN/EXCEPTION WHEN OTHERS` por
  fila (una fila mala no tumba el lote) + dedup que **omite** en vez de pisar.
- **Reporte de rechazos descargable** ("no-importados.csv" con email/nombre/motivo).
- **Autorización + re-normalización en servidor**: el cliente nunca fija el `tenant_id`;
  `service_role` en backend; `REVOKE` de la RPC a anon/authenticated.
- Detección de **correos de relleno repetidos** (`default@sistema.com`) para no marcarlos como
  duplicados falsos.

## Reportes operativos que un negocio en operación sí usa

- **"Cobrado real" vs "proyección"** separados: dinero que entró (neto de reembolsos, sin
  cortesías) vs. proyección a precio de lista. Evita el vanity metric de "ingresos" inflados.
- **Clientes en riesgo** → para Renovacell: **doctores que dejaron de pedir en X días**,
  con contacto, ordenados por urgencia. Señal de churn accionable para ventas.
- **Créditos/saldo por vencer** como pasivo → para Renovacell: **saldo de consignación**.

## Módulos portables tal cual
- `enLetras.ts` — número a letras es-MX ("Son: MIL DOSCIENTOS PESOS 00/100 M.N.") para
  recibos/cortes.
- Motor CSV con BOM/escape/tests.

## Lo que NO aplica (específico de gym)
Heatmap de demanda de clases, no-shows, ocupación por sala/instructor, cohortes de membresía,
MRR/ARR/churn de suscripción, multi-timezone (Renovacell opera en México con pocas sedes).

## Deuda conocida de sala (no copiar a ciegas)
- Agregación de reportes casi toda **client-side** (trae filas crudas, agrega en JS); los
  propios comentarios recomiendan migrar a RPCs con window functions para datasets grandes.
- Inconsistencia de zona horaria: Reportes usa tz del tenant, Caja usa hora local del dispositivo.
- Import histórico de cortes es **manual por SQL** (no hay UI).
- No hay **arqueo por denominación** (billetes/monedas), solo un total contado.