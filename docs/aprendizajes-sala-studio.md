# Aprendizajes de sala-studio para Renovacell

Análisis a fondo (5 agentes) del ERP **sala-studio** —el único sistema de STRYV en
operación real al 100%— para extraer lógica y patrones battle-tested que le sirvan a
Renovacell. Comparado contra lo que Renovacell **ya tiene** (verificado en código).
Fecha: 7 de agosto de 2026.

> sala-studio es de gimnasios (membresías/clases) y Renovacell de distribución médica,
> pero los patrones OPERATIVOS (caja, devoluciones, crédito, auditoría, concurrencia,
> avisos) son transversales. La filosofía de sala: **la defensa vive en la BASE (RPCs +
> triggers + RLS), el front es solo UX; corregir nunca es editar, es asentar una fila
> nueva; cada migración trae su propio test que aborta el deploy si un guard se pierde.**

---

## A. Ya vamos parejos (Renovacell YA lo tiene)
- **Cortes de caja con arqueo** (fondo, cambio, corte por cajero/evento, ticket). ✓
- **Devoluciones que reintegran inventario**, tabla `refunds` **append-only** (trigger anti-UPDATE/DELETE). ✓
- **Importación resiliente** (importar_lote atómico + descargar filas fallidas). ✓
- **Guard anti-escalada de rol** en `profiles` (un no-admin no cambia su `role_id`/`verified`). ✓
- **RLS por rol + helpers** (`auth_role`, `has_cap`, `is_verified`), RPCs `SECURITY DEFINER` con guard de sobreventa. ✓
- **Trazabilidad por lote** (recall, incl. consignación). ✓
- **Notificaciones** con `roles` + `user_ids` (avisos dirigidos). ✓
- **KYC** (cédula + selfie/INE). ✓

Renovacell está más sólido de lo que parecía. Las brechas reales son sobre todo
**funciones operativas**, no seguridad.

---

## B. Brechas de alto valor — priorizadas por ROI en operación médica

### B1 · Cargos pendientes / "cobrar después" (crédito a cliente) — ✅ YA CUBIERTO (verificado)
sala tiene `cargos_pendientes`. **Renovacell ya lo cubre**: el contra-pedido **no cuenta como
ingreso** hasta pagarse (`isSale` excluye `pending_payment`) y Facturación tiene **"Cuentas por
cobrar · por cliente"** con el adeudo total por doctor. Renovacell está **por delante de sala**
aquí. No hay que construir nada.

### B2 · Tres intenciones de devolución — 🟡 CASI CUBIERTO
sala distingue **Devolución** · **Corrección** · **Cortesía**. Renovacell **ya distingue
devolución y corrección** (`RefundTipo`), tabla `refunds` append-only. **Solo falta "cortesía"**
(se cobró pero no debía) y el enlace explícito al pago original (`revierte_pago_id`). Mejora
menor, no urgente.

### B3 · Portal rechaza (duro) vs. staff fuerza informado (blando) — ALTO
sala: los canales **autoservicio** (QR/huella) rechazan; el **mostrador** NO bloquea — pinta
el problema en rojo y deja decidir. Calza exacto con Renovacell: el **Portal del Doctor**
debe rechazar (sin verificar/sin crédito), pero **Ventas/POS** debe poder forzar informado.
Hoy Renovacell no tiene esa asimetría explícita. → Devolver el "estado" en vez de solo
permitir/negar, y dar override en canales de staff. (`sala: 20260717100000`)

### B4 · Ventana de cancelación que decide el reembolso (no bloquea) — MEDIO
Cancelar siempre se permite; la ventana decide la consecuencia económica (antes de picking
= reembolso total; después = cargo/sin reembolso). Renovacell **no tiene política de
cancelación de pedido**. → RPC `cancelar_pedido` con ventana configurable.
(`sala: 20260526100000` cancelar_reserva_atomic)

### B5 · Override-con-aprobación vía flag transaccional — MEDIO
Para excepciones autorizadas (**vender bajo mínimo de stock**, **exceder límite de crédito**)
sin bifurcar el RPC grande: el trigger lanza `APROBACION_REQUERIDA`, la UI confirma, y un
wrapper hace `set_config('...', 'on', true)` local que el trigger lee para permitir. Cero
cambios al core. (`sala: 20260806180000`, `20260815200000`)

### B6 · Traducción de errores técnicos → lenguaje de operador — MEDIO (UX)
sala tiene una capa (`traducirErrorAccion.ts`, ~40 códigos) que convierte `SIN_CREDITOS`,
`42501` (RLS), "Failed to fetch" en frases accionables en 3ª persona. Renovacell muestra
errores más crudos. → Un mapa código→mensaje operable. Barato, alto impacto en mostrador.

### B7 · Avisos por cron (push), no pull — ✅ CONSTRUIDO (7 ago)
sala corre crons idempotentes; Renovacell revisaba caducidad **solo al abrir la pantalla**.
**Construido:** migración `20260807130000_alertas_automaticas.sql` con dos funciones set-based
e idempotentes (columna-sello `caducidad_avisada_at` / `cobranza_avisada_at`): `avisar_lotes_por_caducar()`
(≤60 días o caducado → aviso a Almacén+Dirección) y `avisar_cuentas_por_cobrar()` (contra
pedido no pagado >7 días → aviso a Dirección). Agendadas por **pg_cron** (diario 15:00 UTC) y
`REVOKE` a `authenticated` (solo `service_role`, lección de seguridad de sala). La defensa lazy
del front (`flagExpiring`) se conserva. Pendiente futuro: backorders a reintentar.

### B8 · Comparación "vs. periodo anterior" + KpiCard con bandera "inversa" — MEDIO (reportes)
sala tiene un motor de periodos puro (`calcularRango` + `calcularRangoAnterior`) que alimenta
TODOS los deltas ("vs. mes anterior"), y tarjetas KPI con modo **inversa** (para métricas
donde subir es malo: no-shows, **mermas**, cuentas por cobrar). Renovacell filtra por periodo
pero **no compara**. → Agregar comparación al Tablero/Finanzas.

### B9 · Confirmación tecleada + motivo obligatorio universal — MEDIO
Un componente base para toda acción destructiva: motivo obligatorio (presets + "Otro") y
**teclear una palabra** ("CANCELAR") para confirmar. Renovacell lo tiene suelto (devolución,
merma). → Unificar en un `AccionModal`.

### B10 · Backorder / cola FIFO con SKIP LOCKED — MEDIO-BAJO
Cuando se agota stock, encolar el pedido y promover FIFO al reabastecer, con `FOR UPDATE
SKIP LOCKED` (dos reabastecimientos concurrentes no asignan a la misma persona dos veces).
Renovacell hoy solo rechaza por falta de stock. → Cola de backorders.

### B11 · Cohortes/retención desde un ledger de estado — BAJO
sala reconstruye el estado del socio "a cualquier fecha" (`statusEnFecha`) desde una tabla-
historia append-only, y de ahí saca churn/cohortes correctos. Renovacell tiene "doctores en
riesgo" (buen inicio) pero no cohortes de alta. → `doctor_status_historial` + reportes.

### B12 · Refinar el corte de caja — BAJO
sala: **snapshot inmutable** del resumen (un corte histórico nunca se recalcula), **aviso de
traslape** de rangos ("los mismos cobros contarían dos veces"), y `advisory_lock` para cortes
concurrentes. Renovacell ya tiene el corte; esto lo blinda.

---

## C. Verificaciones de seguridad (resultado en Renovacell)
- ✅ **Guard anti-escalada de rol** — Renovacell **lo tiene** (`guard_service_role.sql`, `rls.sql:403`).
- ⚠️ **REVOKE en funciones internas** — Renovacell solo tiene REVOKE en 1 migración; conviene
  **auditar** que las funciones internas (crons/helpers, si las hay) no sean llamables por
  `authenticated`. Es el hueco más común de Supabase.
- ⚠️ **Dedup de eventos en `stripe-webhook`** — NO hay dedup a nivel evento; el riesgo real es
  bajo porque el update usa `.eq('payment_status','pending')` (un reintento no re-cobra), pero
  el patrón limpio es una tabla `webhook_events(id)`. (Aplica también a CFDI/paquetería.)
- Considerar guard **"≥1 dirección/admin activo"** (sala: `ULTIMO_ADMIN`) — evita quedarse sin acceso.

---

## D. Cultura / método a copiar (vale tanto como los features)
1. **Toda mutación de negocio por RPC canónica, no `UPDATE` directo del cliente.** sala aprendió
   que "cancelar" daba resultados distintos por pantalla (unas UPDATE con RLS laxo, otras RPC).
   Renovacell tiene varios `supabase.from().update()` directos en los stores → migrar los
   sensibles a RPCs que validen reglas + escriban bitácora.
2. **Tests dentro de la migración** (`DO $$ … ROLLBACK`) que abortan el deploy si un guard se
   perdió. Renovacell ya lo hace en parte (ASSERT en devoluciones) → hacerlo estándar.
3. **Test de contrato**: introspeccionar la función y verificar que al recrearla no se perdió
   ningún código de error/guard (sala lo hace con `pg_proc.prosrc`).
4. **Comentarios estilo ADR + nombres de migración = catálogo de incidentes reales.** Los
   nombres de sala ("cancelar_tarde_cuenta_como_noshow", "defaults_que_no_castigan") son un
   mapa de los problemas que un ERP nuevo va a vivir.

---

## Orden sugerido de adopción
1. **B1 (cargos pendientes/crédito)** + **B2 (3 intenciones de devolución)** — corazón contable de la distribución.
2. **B3 (duro autoservicio / blando mostrador)** + **B4 (cancelación con ventana)** — flujo de pedido.
3. **B7 (crons de caducidad/facturas)** + **B6 (traducción de errores)** — operación diaria.
4. **C (auditar REVOKE, dedup webhook)** — seguridad, rápido.
5. **B8/B9/B11/B12** — pulido de reportes y caja.
6. **D (RPCs canónicas, tests en migración)** — método continuo.
