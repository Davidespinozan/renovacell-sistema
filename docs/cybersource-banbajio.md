# BanBajío / CyberSource — auditoría y registro de decisiones

> **Escrito para:** David (dueño y decisor) y quien implemente la pasarela.
> **Tipo:** auditoría **READ-ONLY** + registro de decisiones de producto. No se creó código, migraciones, Edge Functions ni secretos.
> **Fecha:** 2026-10-20 · **Estado del bloque CS-0:** EN DISEÑO (decisiones de links, Caja/POS, portal del doctor y comisiones/MSI cerradas a nivel de producto; CS-0 no terminado) · **CS-1 y posteriores:** NO AUTORIZADOS.
> **PRODUCTION WRITES: 0**

---

## Parte I — Registro de decisiones de producto (CS-0A)

Convención: cada decisión tiene identificador `CS-Dnn`, estado (`APROBADA`, `DIRECCIÓN DEFINIDA / VALIDACIÓN TÉCNICA PENDIENTE`, `ABIERTA`), descripción, justificación, restricciones, dependencias y preguntas pendientes. Una decisión `APROBADA` **no** autoriza implementación; la autorización de cada bloque (CS-1…CS-7) es explícita y aparte.

### CS-D01 — Canales de pago

- **Estado:** APROBADA (2026-10-20).
- **Descripción:** CyberSource debe contemplar tres canales: (1) portal del doctor, (2) links de pago generados desde el ERP, (3) Caja / POS.
- **Justificación:** la empresa prioriza la integración bancaria directa con BanBajío y quiere cubrir venta en línea, cobro remoto y cobro presencial con un solo proveedor.
- **Restricciones:** el mecanismo de cobro presencial en Caja sigue **pendiente de definición**; no asumir que Microform sustituye una terminal bancaria física. Hoy no existen links de pago en el sistema (la auditoría no los encontró): es desarrollo nuevo.
- **Dependencias:** afiliación y credenciales de BanBajío; definición del cobro presencial; reglas de links de pago (ver decisiones abiertas).
- **Preguntas pendientes:** ¿Caja usará terminal física del banco, Microform en el mostrador o un link enviado al cliente? ¿Un link de pago cubre un pedido completo o también abonos?

### CS-D02 — Experiencia de pago

- **Estado:** DIRECCIÓN DE PRODUCTO DEFINIDA; VALIDACIÓN TÉCNICA PENDIENTE (2026-10-20).
- **Descripción:** la experiencia con tarjeta debe ser equivalente a la esperada con Stripe Checkout: el cliente elige tarjeta → captura sus datos en componentes seguros (Microform v2) → completa 3D Secure cuando corresponda → el proveedor autoriza y captura → RENOVACELL verifica el resultado y registra el cobro en el ledger (`registrar_cobro`) → un rechazo no se registra como cobrado → un resultado ambiguo se reconcilia antes de permitir otro intento.
- **Justificación:** mantener la promesa de producto ya diseñada para el portal del doctor sin depender de Stripe; preferencia de producto por **captura inmediata**, no esperar al surtido.
- **Restricciones:** no interpretar esta decisión como autorización para ejecutar cargos reales. Un 3DS exitoso **no** es un pago: se separan siempre tres hechos (3DS terminó, autorización aprobada, cobro registrado). El monto se calcula en el servidor, nunca en el navegador.
- **Dependencias:** confirmar con BanBajío que la afiliación permite autorización y captura conjunta (`processingInformation.capture = true`) y que Microform v2 y Payer Authentication están habilitados.
- **Preguntas pendientes:** ventana de captura si BanBajío solo permite autorización diferida; comportamiento ante abandono del reto 3DS (hoy propuesto: intento cerrado como fallido seguro, sin cobro).

### CS-D03 — Anulaciones, devoluciones y reembolsos desde RENOVACELL

- **Estado:** APROBADA A NIVEL DE PRODUCTO — IMPLEMENTACIÓN CONDICIONADA A CAPACIDADES DEL BANCO (2026-10-20).
- **Criterio aprobado:** RENOVACELL debe ofrecer la gestión más completa posible de anulaciones, devoluciones y reembolsos mediante BanBajío/CyberSource, manteniendo seguridad financiera, trazabilidad y conciliación. Aprobación exclusivamente de PRODUCTO; **no autoriza implementación**.

**Alcance**
- Anulaciones de operaciones con tarjeta cuando CyberSource y BanBajío lo admitan, distinguiendo tres situaciones distintas: (a) autorización pendiente de captura (reversal de autorización), (b) captura aún no liquidada susceptible de anulación (void), (c) operación ya liquidada, que solo admite reembolso (refund). No se asume que toda operación pueda anularse.
- Reembolsos totales, parciales y múltiples parciales sobre un mismo pago, con control del acumulado reembolsado y validación del importe efectivamente capturado y todavía reembolsable.
- Estados de reembolso: solicitado, autorizado, en ejecución, rechazado, pendiente en el proveedor, resultado desconocido, confirmado, conciliado.
- Alternativa manual cuando el banco no habilite una operación por API (ver más abajo).

**Justificación**
- Cerrar el ciclo de dinero con tarjeta dentro del mismo sistema donde se cobra: un cobro que no puede deshacerse de forma controlada obliga a gestionar devoluciones fuera del ledger y rompe la conciliación.
- El ledger W2 ya modela el reembolso como dos hechos separados (autorización → egreso) y la vista de dinero ya calcula lo reembolsado; extenderlo es más seguro que crear un circuito paralelo.

**Lo que el ledger ya soporta (auditado 2026-10-20, hechos)**

| Capacidad | Existe | Dónde |
|---|---|---|
| Autorización de reembolso con tipo (`devolucion`, `correccion`, `cortesia`), monto, motivo, usuario, op_id; tope contra lo ya reembolsado del pedido (`MONTO_EXCEDE`) | Sí | `autorizar_reembolso` (`20261013120200_w2_n3_commands.sql`, autorización de rol en `20261122120000_sec_b_autorizacion_financiera.sql`: admin y billing); tabla `refunds` append-only (`20260804190000_devoluciones.sql`) |
| Egreso del reembolso al ledger, una sola vez por reembolso, con vía, fecha valor y **referencia externa** (`external_ref`) | Sí | `pagar_reembolso` (admin y billing; vía distinta a la del cobro exige Dirección y motivo); `uq_entry_refund_pagado`, `uq_entry_external_ref` |
| Varios reembolsos parciales sobre un pedido | Sí (varias filas en `refunds`) | tope acumulado en `autorizar_reembolso` |
| Compensación de un asiento completo (reversa) solo por Dirección | Sí | `reversar_asiento` (`reversal_of`, `uq_entry_reversa`) |
| Cálculo de reembolsado, cobrado neto, saldo y estado `refunded` | Sí | `v_order_money` (`20261025120000_cc0a_fronteras_autoridad.sql:112-166`) |
| Trazabilidad de la operación (actor, rol, hash de solicitud, resultado) | Sí | `money_operations` kinds `reembolso_autorizado`, `reembolso_pagado`, `reversa_asiento` |
| Cobro original intacto | Sí (ledger append-only; corregir = asiento nuevo) | triggers append-only en `payment_entries` y `refunds` |

**Lo que NO existe hoy (brechas para CS-D03)**
- Estados de ejecución ante el proveedor (solicitado / en ejecución / rechazado / pendiente / desconocido / confirmado): `refunds` y `payment_entries` son hechos contables, no estados en curso.
- Vínculo del reembolso con el **cobro original** y con la **transacción del proveedor** (hoy el tope es por pedido, no por captura).
- Separación solicitud → autorización → ejecución → confirmación: hoy autorización y egreso son dos comandos, sin paso de ejecución externa.
- Estado de conciliación contra el banco.
- Ejecución por API de anulaciones o reembolsos (no hay proveedor de tarjeta activo).

**Reglas de negocio**
1. Importe reembolsable = importe efectivamente **capturado** en el proveedor − reembolsos confirmados − reembolsos en curso (autorizados o pendientes). Nunca devolver más que eso. Se valida en el servidor en el momento de autorizar y de nuevo antes de ejecutar.
2. Un reembolso parcial no bloquea otros parciales posteriores mientras quede importe disponible; cada uno es una operación independiente con su propio motivo.
3. Anulación (reversal / void) solo si el proveedor confirma que la operación aún lo admite; si la ventana pasó, se convierte en reembolso. La decisión la toma el servidor consultando el estado de la transacción, no el operador.
4. El cobro original nunca se edita ni se borra; toda devolución es un movimiento compensatorio nuevo (`direction = 'out'`) o una reversa.
5. No se registra un reembolso como completado sin evidencia del proveedor: respuesta de CyberSource con identificador de reembolso, o evidencia bancaria verificable en la vía manual.
6. Resultado desconocido (timeout, respuesta ambigua): el reembolso queda en `unknown_requires_reconciliation`; prohibido reintentarlo en automático; se resuelve consultando el estado por identificador de transacción.
7. Reembolsos rechazados por el proveedor quedan registrados como rechazados, con el motivo del proveedor depurado, sin movimiento contable.

**Seguridad y permisos (inicial)**
- Solo **Dirección** (rol `admin`) autoriza anulaciones y reembolsos de tarjeta. `billing` conserva lo que ya tiene en el ledger manual; la ampliación a otros roles es decisión futura (ver decisiones abiertas).
- Se registra usuario responsable, fecha, importe, motivo y referencia de la operación (ya lo hacen `refunds` + `money_operations`; se añade la referencia del proveedor).
- El frontend **nunca** ejecuta operaciones financieras contra CyberSource: solo pide al servidor; la Edge firma y llama; la base registra.
- Separación por pasos: solicitud (quien detecta la necesidad) → autorización (Dirección) → ejecución (servidor) → confirmación (respuesta del proveedor o evidencia). Cuando una misma persona de Dirección solicita y autoriza, se registran ambos pasos igualmente.
- Los secretos del proveedor viven solo en la Edge; nada de PAN, CVV ni cuerpos de respuesta completos en logs.

**Estados financieros (propuesta de máquina de estados)**

| Estado | Significado | Movimiento contable |
|---|---|---|
| `solicitado` | alguien pidió devolver dinero | ninguno |
| `autorizado` | Dirección aprobó importe y motivo (`autorizar_reembolso` → fila en `refunds`) | ninguno aún |
| `en_ejecucion` | la Edge reclamó el intento y llamó al proveedor | ninguno |
| `rechazado` | el proveedor rechazó | ninguno; motivo registrado |
| `pendiente_proveedor` | el proveedor aceptó pero no ha liquidado | ninguno hasta confirmar |
| `desconocido` | timeout o respuesta ambigua | ninguno; requiere reconciliación |
| `confirmado` | evidencia del proveedor con identificador | egreso vía `pagar_reembolso` con `external_ref` = id del proveedor |
| `conciliado` | cuadrado contra reporte bancario | marca de conciliación |
| `gestion_externa` | se tramitará fuera del sistema (vía manual) | ninguno hasta evidencia verificada |

**Integración financiera (diseño, no implementado)**
- Reutilizar `autorizar_reembolso` (autorización) y `pagar_reembolso` (egreso) tal como existen; el egreso se registra **solo** al llegar a `confirmado`, con `external_ref` = identificador del reembolso en CyberSource (`uq_entry_external_ref` impide duplicados).
- Para las anulaciones de una autorización sin captura no hay cobro en el ledger (no se registra cobro hasta capturar), así que la anulación vive solo en el estado del intento. Para un void de captura no liquidada con cobro ya registrado, el movimiento compensatorio es el mismo que un reembolso total.
- Candidata para los estados en curso: una tabla de **intentos de reembolso** (análoga a `shipping_attempts` y a la futura tabla de intentos de cobro), con claim único por reembolso autorizado, identificadores del proveedor, importe, estado y evidencia. Se propone porque `refunds` y `payment_entries` no deben mutar. Validar antes de crearla si la tabla de intentos de cobro (CS-2) puede albergar también reembolsos con un campo `kind`.
- **Atomicidad:** la llamada al banco y la escritura local **no** son una sola transacción. Orden obligatorio: (1) claim del intento con el importe exacto → (2) llamada al proveedor → (3) guardar la evidencia en el intento → (4) `pagar_reembolso` en una transacción que cierra el intento. Si (4) falla tras un éxito bancario, el intento queda `desconocido` con la evidencia guardada y una pantalla de reconciliación permite completar (4) sin volver a llamar al banco. Si (2) agota el tiempo, se consulta el estado por identificador antes de decidir.
- Conciliación: cada reembolso confirmado se cruza con el reporte o búsqueda de transacciones del proveedor por `external_ref`; marca de conciliado en el intento.

**Experiencia operativa futura (dirección, sin pantallas definitivas)**
Dirección debería poder: consultar pagos realizados e identificar el proveedor; ver importe original, capturado y saldo reembolsable; solicitar anulación o reembolso total o parcial con motivo; confirmar con controles (segundo paso, resumen del importe); consultar historial y estado; ver lo pendiente de conciliación. Se diseñará sobre la Revisión económica existente (`apps/web/src/screens/admin/RevisionEconomica.tsx`) o junto a ella; no se diseñan componentes todavía.

**Alternativa manual (si el banco no habilita una operación por API)**
- Registrar la operación como `gestion_externa` con quién la tramita y por qué vía.
- Distinguir solicitada, ejecutada externamente y confirmada.
- Exigir referencia bancaria y evidencia verificable (comprobante en el bucket privado de evidencias) antes de `confirmado`; una declaración manual sin evidencia no completa el reembolso.
- Conciliar contra la información bancaria.

**Dependencias de BanBajío (pendientes de confirmar; capacidades documentadas de CyberSource ≠ habilitadas en la afiliación)**

| # | Pendiente | Documentado en CyberSource | Habilitado por BanBajío |
|---|---|---|---|
| 1 | Disponibilidad de voids (`/pts/v2/payments/{id}/voids`, `/captures/{id}/voids`) | Sí | Por confirmar |
| 2 | Reembolsos por API (`/pts/v2/payments/{id}/refunds`, `/captures/{id}/refunds`) | Sí | Por confirmar |
| 3 | Reembolsos parciales | Sí | Por confirmar |
| 4 | Múltiples reembolsos parciales sobre una captura | Sí | Por confirmar |
| 5 | Ventanas de anulación (reversal / void) y de reembolso | Depende del adquirente | Por confirmar |
| 6 | Restricciones por tipo de tarjeta y transacción (débito, MSI, internacionales) | Depende del adquirente | Por confirmar |
| 7 | Consulta de estados (`/tss/v2/transactions/{id}`, búsquedas) | Sí | Por confirmar |
| 8 | Webhooks o reportes para conciliación | Sí (suscripciones) | Por confirmar |
| 9 | Permisos y credenciales necesarios para estas operaciones (roles en Business Center) | Sí | Por confirmar |

**Riesgos**
- Devolución duplicada por reintento tras timeout → claim único + consulta de estado + `external_ref` único.
- Reembolso registrado sin que el banco lo haya ejecutado → egreso solo en `confirmado` con evidencia.
- Éxito bancario con fallo local → evidencia guardada en el intento antes del cierre y pantalla de reconciliación.
- Superar el importe capturado por reembolsos concurrentes → cálculo del disponible con bloqueo por pedido en el servidor (patrón de bloqueo ya usado en `revisar_pago`).
- Operación manual declarada sin respaldo → evidencia obligatoria y estado separado.
- Capacidades no habilitadas por el banco → detección en sandbox antes de diseñar pantallas; vía manual como respaldo.

**Preguntas abiertas**
- ¿Billing podrá ejecutar reembolsos de tarjeta más adelante, o solo Dirección?
- ¿La devolución física de producto (`stock_returns`) debe exigirse antes del reembolso de tarjeta, como hoy es opcional?
- ¿Los reembolsos de cobros por Stripe (si algún día se activa) seguirán el mismo circuito? (Diseño: sí, mismo circuito con otro proveedor; no se implementa.)
- ¿Una misma tabla de intentos para cobros y reembolsos, o dos?

**Restricciones de implementación**
- Nada de lo anterior está implementado ni autorizado. Corresponde al bloque **CS-7** (y a CS-2 para la tabla de intentos), que requieren autorización explícita y sandbox del banco.
- No crear tablas ni RPCs hasta confirmar con BanBajío los puntos 1–9.
- No tocar `refunds`, `payment_entries`, `autorizar_reembolso`, `pagar_reembolso` ni `reversar_asiento` salvo por migración revisada con rollback y pruebas de base.

### CS-D04 — Estrategia de proveedores

- **Estado:** APROBADA (2026-10-20).
- **Descripción:** BanBajío/CyberSource es el proveedor principal inicial. Stripe permanece preparado pero inactivo.
- **Justificación:** decisión de la empresa de priorizar la relación bancaria directa; Stripe no está descartado y podría integrarse después.
- **Restricciones:** no eliminar código ni estructuras de Stripe (`stripe-checkout`, `stripe-webhook`, `apps/web/src/lib/stripe.ts`, `orders.stripe_payment_id`); no activar Stripe; no acoplar el ledger financiero exclusivamente a CyberSource (el cobro sigue entrando por `registrar_cobro` con `external_ref` del proveedor, método `tarjeta`); **no** construir todavía un selector de proveedores ni una plataforma multipasarela.
- **Dependencias:** ninguna externa.
- **Preguntas pendientes:** qué mostrará el botón "Pagar ahora" mientras CyberSource no esté activo (hoy enruta a Stripe y responde "aún no disponible").

### CS-D05 — Links de pago para pedidos y cobros independientes

- **Estado:** APROBADA A NIVEL DE PRODUCTO / IMPLEMENTACIÓN NO AUTORIZADA (2026-10-20, bloque CS-0C).
- **Descripción:** RENOVACELL permitirá emitir enlaces de pago con tarjeta (BanBajío/CyberSource) desde el ERP, para pedidos existentes y para cobros independientes, con importe fijado al emitir, vigencia limitada, permisos por rol validados en el servidor, un solo cobro exitoso por enlace y registro idempotente en el ledger.
- **Justificación:** cubrir el canal 2 de CS-D01 (cobro remoto desde el ERP) sin depender de que el cliente entre al portal, y dar a Facturación y al personal comercial una forma controlada de cobrar anticipos y conceptos sueltos sin falsear pedidos.
- **Hecho de partida (auditoría):** hoy no existen links de pago, ni tablas de enlaces, intentos o reservas; es desarrollo nuevo. El ledger (`payment_claims`, `payment_entries`, `money_operations`, `v_order_money`) y `registrar_cobro` son la base a respetar.

**A. Alcance**
1. Enlaces para **pedidos existentes**.
2. Enlaces para **cobros independientes**: anticipos, servicios y otros conceptos.
- Los cobros independientes tendrán identidad, trazabilidad y registro financiero propios. **No se simularán como pagos de pedidos** (ni pedidos ficticios ni asientos colgados de un pedido ajeno).
- La integración respeta el ledger existente y sus invariantes (append-only, op_id, `external_ref` único, egreso solo con reembolso autorizado).

**B. Importes**
- Enlaces por **saldo completo** o por **importe parcial**.
- El importe queda **fijado al emitir**; el cliente no puede modificarlo.
- El servidor impide sobrecobros considerando: pagos confirmados, operaciones en curso y reservas activas.

**C. Vigencia**
- Predeterminada: **24 horas**. Duración configurable al generar el enlace, dentro de límites que fija Dirección.
- Caducidad automática; revocación manual autorizada.
- Límites mínimo y máximo concretos: **pendientes de configuración/diseño**.

**D. Permisos (validados en el servidor, no solo en la interfaz)**

| Rol | Generar | Consultar / administrar | Revocar | Políticas y límites |
|---|---|---|---|---|
| Dirección (`admin`) | Sí | Todos | Propios y ajenos | Define |
| Facturación (`billing`) | Sí | Todos | Dentro de sus atribuciones | No |
| Personal comercial **expresamente autorizado** (hoy: perfiles `pos` con capacidad comercial; la autorización explícita es un dato a diseñar) | Sí | Solo los propios | Solo los propios | No |
| Otros usuarios | No | No | No | No |

- Toda revocación registra usuario, fecha, motivo y enlace afectado.
- Los reembolsos de cobros por enlace conservan CS-D03: autorización exclusiva de Dirección.

**E. Distribución**
1. Copiar enlace.
2. Compartir por WhatsApp con mensaje prellenado (enlace `wa.me` / compartir del dispositivo; sin API).
3. Enviar correo desde RENOVACELL con plantilla profesional y **registro del envío**.
- La integración automatizada con WhatsApp Business API queda para una fase posterior (ver frente Meta).
- Correo: existe una cola transaccional (`comm_outbox`, migración `20261021120000_w4_comunicaciones.sql`), la Edge `comm-dispatch` y plantillas en `supabase/functions/_shared/plantillas.ts`. **No se asume** que soporten este flujo: falta verificar proveedor activo, plantilla nueva, registro del envío por enlace y comportamiento ante rebotes.

**F. Uso único y reintentos**
- Un enlace admite **un solo cobro exitoso**; puede permitir varios **intentos fallidos controlados**.
- Rechazo bancario confirmado: reintento permitido mientras el enlace siga vigente y válido, con límite de intentos y controles antifraude (política exacta pendiente).
- Resultado bancario **desconocido**: bloquear nuevos intentos hasta conciliar.
- Cobro exitoso: el enlace se consume.
- Enlace vencido, revocado o invalidado: no admite nuevos cargos.
- **Intento de pago ≠ enlace de pago.** Un reintento de comunicación ante resultado incierto no crea un cargo nuevo: primero se consulta el estado de la transacción por su identificador.

**G. Cambios de importe**
- Si cambia el importe cobrable de un pedido o concepto: invalidar los enlaces afectados y permitir emitir nuevos con el saldo actualizado. Nunca modificar silenciosamente el importe de un enlace emitido.
- Si hay una transacción bancaria en curso, invalidar el enlace **no** cancela esa transacción: se resuelve primero su estado bancario y financiero.

**H. Múltiples enlaces y concurrencia**
- Se permiten varios enlaces activos para un mismo pedido o concepto.
- Requisitos de producto: validación del saldo disponible en el servidor; reserva temporal del importe **durante una operación en curso**; protección ante solicitudes concurrentes; prevención de sobrecobros; conservación de bloqueos mientras exista un resultado desconocido; liberación de reservas solo por reglas seguras y evidencia suficiente; reconciliación antes de permitir nuevos cargos cuando corresponda.
- Una reserva interna **no** es un cobro, ni una autorización bancaria, ni un asiento contable.
- No se reserva la suma de todos los enlaces emitidos: se distingue **enlace emitido** de **operación efectivamente iniciada** (solo esta última reserva).

**I. Conciliación e integridad financiera**
- El frontend nunca determina que un cobro fue exitoso; solo evidencia confiable del proveedor confirma el resultado.
- El pago entra al ledger por mecanismos idempotentes (op_id derivado de la transacción del proveedor; `external_ref` único); sin duplicados por reintentos, callbacks ni fallos de comunicación.
- Si el banco confirma el cargo y falla el registro local: conservar la evidencia y completar por conciliación, **sin repetir el cargo**.
- Se respeta el modelo contable existente; los cobros independientes requieren definir su propio encaje contable (dependencia técnica 1).

**Dependencias técnicas abiertas (diseño; NO autorización para desarrollar)**
1. Modelo contable de cobros independientes y su relación con el ledger existente (hoy todo asiento cuelga de `order_id`).
2. Diseño de entidades para enlaces, intentos y reservas.
3. Concurrencia, atomicidad e idempotencia de reservas.
4. Expiración o revocación durante un intento bancario en curso.
5. Reconciliación de resultados desconocidos.
6. Política exacta de límites antifraude y reintentos.
7. Límites configurables de vigencia (mínimo, máximo, quién los cambia).
8. Capacidades reales de CyberSource habilitadas por BanBajío (ver tablas en CS-D03 y en la auditoría).
9. Integración con la infraestructura actual de correo (`comm_outbox`, `comm-dispatch`, plantillas).
10. Aplicación de permisos conforme a roles y autorizaciones reales del ERP (cómo se marca "personal comercial expresamente autorizado").

**Restricciones de implementación**
- Nada implementado ni autorizado; corresponde a bloques posteriores a CS-1 que se definirán cuando BanBajío confirme capacidades.
- No crear tablas, RPCs, Edge Functions ni pantallas hasta cerrar las dependencias 1–3 y 8.

### CS-D06 — Cobros presenciales en Caja / POS

- **Estado:** APROBADA A NIVEL DE PRODUCTO / DOCUMENTADA / IMPLEMENTACIÓN NO AUTORIZADA (2026-10-20, bloque CS-0D).
- **Descripción:** RENOVACELL contemplará tres modalidades de cobro con tarjeta en mostrador: terminal bancaria física integrada de forma bidireccional, cobro digital presencial (QR o enlace) y terminal bancaria externa con registro controlado. Todas con confirmación financiera estricta, pagos mixtos y parciales, y separación entre correcciones administrativas y reembolsos bancarios (CS-D03).
- **Justificación:** cubrir el canal 3 de CS-D01 sin depender de una sola tecnología: la terminal integrada puede no estar disponible en la afiliación, el cobro digital reutiliza CyberSource y CS-D05, y la terminal externa mantiene operativa la Caja en cualquier escenario.
- **Hechos de partida (auditoría):** Caja registra hoy ventas con `vender_pos` (asiento propio en el ledger; medios `efectivo`, `tarjeta`, `transferencia`, `stripe` u `otro`; `20261129120000_sec_c4_fiscal2_pos_validation.sql`), los cortes de caja viven en `cash_closings`, y la liberación para surtir depende de `pedido_liberado_para_surtir` (cobro suficiente o crédito autorizado vigente, `20261013120200_w2_n3_commands.sql:56-68`). No existe integración con terminales ni QR de pago.

**A. Terminal bancaria física integrada (bidireccional)**
1. Caja selecciona la venta y el importe.
2. El servidor solicita el cobro a la terminal bancaria asignada.
3. El cliente paga con tarjeta física o contactless.
4. Se recibe un resultado bancario verificable.
5. El servidor registra el pago de forma idempotente y actualiza el saldo.
6. Los resultados desconocidos quedan sujetos a conciliación, sin repetir cargos automáticamente.
- **Condición:** depende de que BanBajío o su proveedor de terminales ofrezca y habilite una solución compatible, con sus protocolos, credenciales y mecanismos de conciliación. **No se asume** que CyberSource Flex Microform integre terminales físicas ni que la afiliación ya incluya esta funcionalidad. No se afirma que sea viable hasta confirmarlo.

**B. Cobro digital presencial (QR o enlace)**
- Caja puede generar un QR visible en pantalla o un enlace compartible, vinculados al cobro correspondiente.
- Reutilizan las reglas de CS-D05: importes completos o parciales, uso único tras cobro exitoso, vigencia y revocación, reintentos controlados, prevención de sobrecobros, protección de concurrencia, resultados desconocidos y conciliación.
- El cliente paga desde su dispositivo en el flujo seguro de CyberSource, con 3D Secure cuando corresponda. Caja no captura ni almacena PAN/CVV.
- La pantalla de Caja solo muestra "pagado" después de la verificación confiable del servidor.

**C. Terminal bancaria externa (no integrada)**
- El cliente paga en un dispositivo independiente; personal de Caja **expresamente autorizado** registra el pago con evidencia obligatoria y controles de verificación (sección "Registro controlado").
- Esta alternativa se mantiene disponible aunque la integración bidireccional no sea viable.

**Confirmación financiera estricta (regla obligatoria)**
- Una venta solo se considera pagada cuando existe confirmación bancaria confiable, o un pago externo verificado conforme a las políticas del ERP.
- Nunca se marca pagado un cobro pendiente, rechazado, desconocido, sin evidencia suficiente o basado solo en una afirmación del frontend.
- Se separan tres estados: operativo de Caja, de la transacción bancaria y financiero del ledger.
- Una venta con saldo pendiente no está totalmente pagada (`v_order_money.saldo`).

**Registro controlado de pagos externos**
- Mínimo exigido: venta u obligación vinculada, importe, medio, referencia de operación bancaria, fecha y hora, terminal o identificador del medio cuando corresponda, responsable del registro, evidencia verificable y estado de validación.
- Prevención de referencias duplicadas; auditoría de registro y correcciones; supervisión por Facturación y Dirección; distinción entre **captura de evidencia** y **validación del pago** (hoy el ledger ya separa `reportar_pago` → `revisar_pago`; la vía de Caja deberá encajar en ese esquema o en uno equivalente, a diseñar).
- Una referencia escrita a mano **no** constituye por sí sola confirmación bancaria. Los criterios de evidencia y responsabilidades se fijarán según el nivel de riesgo.

**Pagos mixtos y parciales**
- Se pueden combinar en una misma venta: efectivo, tarjeta por integración bancaria, terminal externa, transferencia, enlace o QR.
- Cada cobro tiene su propio movimiento financiero con importe, medio, referencia, responsable y estado.
- Se permiten pagos parciales conservando el saldo; se impiden sobrecobros considerando cobros confirmados y operaciones en curso.
- **Regla separada:** un pago parcial no autoriza por sí mismo la entrega de mercancía ni concede crédito. La entrega con saldo pendiente se rige por las políticas independientes de crédito y entrega existentes (`pedido_liberado_para_surtir`, `credit_grants`) o futuras. Este bloque no las modifica.

**Correcciones y reversas**
- *Correcciones administrativas:* Caja solicita; Facturación o Dirección autoriza según permisos; nunca se eliminan ni sobrescriben movimientos originales; se usan movimientos compensatorios permitidos por el ledger (`reversar_asiento`, reembolso de tipo `correccion`); se registra solicitante, autorizador, motivo, fecha, importe y referencias.
- *Anulaciones y reembolsos bancarios:* exclusivamente por CS-D03 (autorización de Dirección, evidencia bancaria, idempotencia, conciliación, asiento compensatorio).
- Una corrección administrativa nunca se presenta como cancelación bancaria cuando el dinero sí fue cobrado. No habrá atajos para que Facturación o Caja ejecuten reembolsos bancarios sin Dirección.

**Terminal bidireccional y conciliación (experiencia objetivo, no compromiso de viabilidad)**
- Terminal asignada a Caja o punto de cobro; importe y referencia enviados desde RENOVACELL; identidad única de operación; resultado verificable del proveedor; confirmación y registro idempotentes; consulta o reconciliación de estados ambiguos; protección ante doble cobro; auditoría de solicitudes y respuestas sin datos sensibles de tarjeta.
- Un resultado desconocido no se trata como rechazado. No se repite un cargo por timeout, cierre de pantalla o fallo de comunicación.

**Dependencias técnicas y bancarias (pendientes de auditoría o confirmación; no son decisiones técnicas)**
1. Proveedor, modelos y capacidades de terminales de BanBajío.
2. Disponibilidad de integración bidireccional y su documentación técnica.
3. Protocolos, certificaciones, credenciales y entornos de prueba.
4. Asignación y administración de terminales por Caja.
5. Diseño de estados e intentos de cobro presencial.
6. Criterios de evidencia verificable para terminales externas.
7. Roles y permisos reales de Caja, Facturación y Dirección (hoy: `pos`, `billing`, `admin`).
8. Compatibilidad de pagos mixtos con el ledger existente (`vender_pos` registra hoy un solo medio por venta).
9. Concurrencia entre Caja, portal del doctor y enlaces de pago sobre un mismo pedido.
10. Conciliación de operaciones bancarias ambiguas.
11. Manejo de caídas de red o terminal desconectada.
12. Tratamiento contable de correcciones frente a devoluciones reales.
13. Políticas independientes de entrega con saldo pendiente.
14. Capacidades bancarias reales de anulaciones y reembolsos según CS-D03.

**Restricciones de implementación**
- Nada implementado ni autorizado. No se crean tablas, RPCs, Edge Functions ni pantallas; no se modifica `vender_pos`, los cortes de caja ni las políticas de liberación.
- La modalidad A no se diseña en detalle hasta confirmar las dependencias 1–3; las modalidades B y C dependen de CS-D05 y de los criterios de evidencia (6).

### CS-D07 — Cobro seguro del saldo pendiente en el portal del doctor

- **Estado:** APROBADA A NIVEL DE PRODUCTO / DOCUMENTADA / IMPLEMENTACIÓN NO AUTORIZADA (2026-10-20, bloque CS-0E).
- **Descripción:** el portal del doctor cobra con CyberSource únicamente el **saldo pendiente real** del pedido, con checkout integrado en el portal (Microform v2 + 3DS), confirmación desde el servidor, recuperación automática de operaciones interrumpidas y protecciones financieras compartidas con los demás canales.
- **Justificación:** hoy el flujo preparado con Stripe cobra el total del pedido y, tras un abono, el webhook descartaría el evento por diferencia de importe (hallazgo de la auditoría). El doctor debe ver y pagar exactamente lo que debe, y el servidor debe impedir cualquier sobrecobro aunque otro canal registre pagos al mismo tiempo.
- **Hechos de partida (auditoría, sujetos a verificación técnica):** `PaymentModal` (`apps/web/src/screens/doctor/PaymentModal.tsx`) con "Pagar ahora" desde el checkout canónico y Mis pedidos; `v_order_money` (total, cobrado, reembolsado, cobrado_neto, saldo, estado_pago); `registrar_cobro` y el ledger append-only con `uq_entry_external_ref` y op_id; `stripe-checkout` / `stripe-webhook` preparados e inactivos; sin tabla de intentos bancarios ni reservas.

**Importe cobrable (decisión vinculante)**
- Se cobra **solo el saldo pendiente real**; nunca el total original de forma automática cuando existan anticipos, abonos u otros pagos confirmados.
- El portal muestra: total vigente del pedido, pagos confirmados, saldo pendiente real e importe que se cobrará por CyberSource.
- Antes de **cada** cargo el servidor recalcula el importe cobrable considerando: movimientos confirmados, operaciones bancarias en curso, reservas temporales aplicables, pagos registrados desde otros canales, cambios válidos del importe del pedido, y reembolsos o reversas conforme al ledger.
- Sin sobrecobros; el importe enviado por el frontend nunca es fuente de verdad.
- **Alcance:** el doctor paga el saldo pendiente **completo** disponible. No se introduce una función de abonos parciales elegidos libremente por el doctor. Esto no limita los pagos parciales autorizados en otros canales (CS-D05, CS-D06).

**Pedido totalmente pagado**
- Saldo cero y cobros confirmados: estado **Pagado**, acción "Pagar ahora" desactivada, desglose financiero visible, nuevos cargos impedidos.
- Con operaciones de resultado desconocido: estado **Pendiente de verificación**; no se afirma "pagado" por una transacción sin confirmar; se bloquean cargos que puedan duplicarla; el caso queda sujeto a conciliación.
- Se distinguen siempre saldo financiero, pagos confirmados y operaciones pendientes.

**Recuperación de pagos interrumpidos**
- Al cerrar el navegador, recargar, perder conexión, volver tras una interrupción o regresar de un desafío 3DS, el portal recupera el estado **desde el servidor** por la identidad de la operación existente.
- Pago confirmado: mostrar confirmación, reflejar el movimiento registrado, actualizar saldo.
- Rechazado definitivamente: mostrar resultado y permitir un nuevo intento seguro cuando corresponda.
- En proceso: mostrar verificación; no crear otro cargo automáticamente.
- Resultado desconocido: bloquear cargos potencialmente duplicados, consultar o conciliar el estado, no tratar un timeout como rechazo, no marcar pagado sin evidencia.
- Éxito bancario con fallo del registro local: conservar la evidencia y completar el asiento por conciliación idempotente, sin repetir la operación bancaria.

**Checkout integrado en el portal (decisión vinculante)**
- Dirección técnica aprobada: Flex Microform v2 para los campos de tarjeta; tokenización por los mecanismos oficiales del proveedor; 3D Secure / Payer Authentication cuando corresponda según el banco; confirmación del resultado desde el servidor; retorno a la vista del pedido con el estado financiero actualizado.
- Conserva la identidad visual de RENOVACELL. Los desafíos de autenticación pueden requerir componentes, ventanas o redirecciones externas según el flujo oficial.
- Seguridad: RENOVACELL no captura, almacena ni registra PAN/CVV; nada sensible en logs, telemetría ni errores; el frontend no confirma cobros; un token, una URL de retorno o una afirmación del navegador **no** son prueba suficiente; el resultado se verifica con mecanismos confiables de CyberSource; sandbox y producción separados.
- No se afirma que la integración funcione ni se garantiza una clasificación PCI concreta sin evaluación.

**Concurrencia entre canales**
- El portal comparte las protecciones financieras con los enlaces de CS-D05, Caja/POS de CS-D06, los registros autorizados de transferencias y cualquier otro canal del ERP.
- Ejemplo de referencia: el doctor abre el checkout por $10,000 y Facturación registra un abono de $4,000 antes de iniciar el cargo. El servidor detecta el cambio y exige que el doctor revise y confirme el nuevo importe cobrable; nunca ejecuta en silencio el cargo original.
- Si ya existe una operación bancaria iniciada, primero se resuelve su estado y se respetan reservas y reglas de conciliación.
- Requisito: operaciones simultáneas desde distintos canales no pueden cobrar más que el saldo disponible. **No se asume** que los controles actuales del ledger cubran toda esta concurrencia sin auditoría técnica (hoy `revisar_pago` bloquea por pedido, pero no existen reservas ni intentos bancarios).

**Reutilización de arquitectura existente (punto de partida, sujeto a verificación)**
- `PaymentModal` y el paso "Pagar ahora"; `v_order_money`; `registrar_cobro` y los comandos del ledger; ledger append-only e invariantes; idempotencia por op_id y `external_ref`; Stripe preparado e inactivo.
- CyberSource es el proveedor principal previsto para este flujo. Stripe se preserva sin eliminarlo, activarlo ni construir anticipadamente un selector multiproveedor. No se duplica la lógica financiera existente. En este bloque no se crea ninguna implementación.

**Dependencias técnicas abiertas (auditoría y diseño; no decisiones implementadas)**
1. Obtención segura del saldo cobrable desde el ledger (`v_order_money` + operaciones en curso y reservas).
2. Coordinación de reservas entre portal, enlaces y Caja.
3. Identidad e idempotencia de intentos bancarios.
4. Recuperación de operaciones interrumpidas.
5. Consultas de estado y conciliación con CyberSource.
6. Manejo de autenticación 3DS, desafíos y retornos.
7. Validación del resultado bancario en el servidor.
8. Persistencia ante éxito bancario y fallo local.
9. Tratamiento de modificaciones del pedido durante el checkout.
10. Seguridad, accesibilidad y errores de la interfaz.
11. Capacidades y configuración reales habilitadas por BanBajío.
12. Reutilización segura de componentes existentes sin afectar Stripe.

**Restricciones de implementación**
- Nada implementado ni autorizado; corresponde a los bloques CS-2…CS-6 del plan, que requieren autorización explícita y sandbox del banco.
- No se modifica `PaymentModal`, `lib/stripe.ts`, `v_order_money`, `registrar_cobro` ni las funciones de Stripe en este bloque.

### CS-D08 — Política de comisiones bancarias y meses sin intereses (MSI)

- **Estado:** APROBADA A NIVEL DE PRODUCTO / DOCUMENTADA / IMPLEMENTACIÓN NO AUTORIZADA (2026-10-20, bloque CS-0F).
- **Descripción:** RENOVACELL absorbe las comisiones bancarias como costo financiero interno; el doctor paga solo el importe legítimamente cobrable. Los meses sin intereses (MSI) se ofrecen únicamente cuando BanBajío confirme expresamente la modalidad para la afiliación, con configuración exclusiva de Dirección, validación en el servidor y costos absorbidos por RENOVACELL.
- **Justificación:** mantener transparente y estable el importe que ve el doctor (ya fijado en CS-D05 y CS-D07 como saldo cobrable), evitar que la comisión contamine el ledger de pedidos y dar a Dirección control total sobre una herramienta comercial cuyo costo recae en la empresa.
- **Hechos de partida (auditoría):** el ledger registra cobros por su importe bruto contra el pedido (`payment_entries.amount`, `registrar_cobro`); no existe hoy ninguna estructura de comisiones, costos bancarios, liquidación neta ni MSI. La forma contable y técnica concreta de registrar comisiones **queda pendiente de auditoría y diseño**.

**A. Comisiones bancarias (decisión aprobada: las absorbe RENOVACELL)**
- El cliente o doctor paga únicamente el importe legítimamente cobrable.
- No se incrementa automáticamente el saldo por comisiones de procesamiento; no se agregan porcentajes ni cargos fijos al checkout por usar tarjeta.
- No se descuenta la comisión bancaria del importe aplicado al pedido.
- Se registran por separado, según la evidencia disponible: importe bruto de la transacción, comisiones, otros costos bancarios aplicables e importe neto liquidado.
- Se mantiene la conciliación entre CyberSource, BanBajío y el ledger de RENOVACELL.
- Una comisión bancaria no es un descuento comercial, ni un reembolso, ni un saldo pendiente del doctor.
- Ejemplo ilustrativo: saldo cobrable $10,000 MXN → el doctor paga $10,000 → RENOVACELL registra el cobro por $10,000 contra el pedido → la comisión, cualquiera que sea su importe real, es costo financiero interno conciliado por separado.
- **No se inventan tasas, porcentajes, impuestos ni tarifas bancarias.**

**B. Meses sin intereses (decisión aprobada: configurables exclusivamente por Dirección)**
- RENOVACELL podrá ofrecer MSI cuando el banco confirme expresamente que la modalidad está disponible para la afiliación.
- Solo Dirección habilita o deshabilita la oferta de MSI y modifica sus políticas: plazos efectivamente autorizados por BanBajío, montos mínimos elegibles y canales donde se ofrece (siempre que la integración y la afiliación los soporten).
- No se habilitan plazos no confirmados por el banco. No se asume que todas las tarjetas, emisores, marcas, transacciones o canales sean elegibles. No se promete MSI antes de validar las condiciones bancarias.
- El doctor conoce y confirma la modalidad seleccionada antes de iniciar el cargo.
- El servidor valida plazo, elegibilidad, importe y condiciones de la operación; una selección de MSI enviada por el frontend nunca se acepta sin validación.
- **Los costos bancarios de MSI los absorbe RENOVACELL**; no se traslada al doctor una comisión adicional por elegir MSI.
- Esta decisión **no** autoriza a RENOVACELL a otorgar crédito directamente; la financiación por MSI, cuando exista, depende de los mecanismos y condiciones reales del banco y del emisor.

**C. Importe del pedido y conciliación**
- Las operaciones MSI respetan las mismas invariantes aprobadas para CyberSource: importe = saldo legítimamente cobrable; cobros confirmados registrados de forma idempotente; comisiones y costos no alteran artificialmente el saldo del doctor.
- El importe neto depositado por el banco puede diferir del bruto cobrado; la diferencia debe explicarse con comisiones, retenciones u otros conceptos bancarios documentados. Un depósito neto menor **no** es prueba de que el doctor pagó menos.
- No se generan cargos adicionales por fallos de conciliación. No se registran pagos como confirmados solo porque el frontend reportó éxito.
- No se asume el calendario de liquidación bancaria ni la distribución de mensualidades: dependen del programa MSI real.
- Se preservan las reglas de CS-D03 (anulaciones y reembolsos solo con autorización de Dirección). Los efectos bancarios de devoluciones de operaciones MSI se verificarán específicamente con BanBajío.

**D. Experiencia del doctor**
- Con MSI habilitado y operación elegible, el checkout integrado (CS-D07) puede presentar las modalidades realmente disponibles, por ejemplo pago de contado, 3 MSI o 6 MSI. **Estos plazos son ejemplos conceptuales; ninguno se registra como disponible hasta la confirmación bancaria.**
- La experiencia muestra claramente el importe total e identifica el plazo seleccionado; presenta mensualidades solo cuando puedan calcularse de forma confiable; evita promesas sobre elegibilidad de tarjetas no verificadas; permite una confirmación informada antes del cargo; conserva las protecciones de saldo, idempotencia, 3DS y conciliación de CS-D07.
- Sin MSI disponibles, el checkout ofrece únicamente las modalidades efectivamente habilitadas.

**Dependencias abiertas con BanBajío (pendientes de confirmación; ninguna se declara confirmada)**
1. Si la afiliación contratada permite meses sin intereses.
2. Qué plazos específicos están disponibles.
3. Qué tarjetas, marcas, emisores y tipos de transacción son elegibles.
4. Qué canales pueden ofrecer MSI: portal del doctor, enlaces de pago, Caja/POS.
5. Si la funcionalidad se habilita mediante CyberSource, BanBajío u otro componente.
6. Qué parámetros, identificadores y campos requiere cada operación MSI.
7. Qué comisiones y costos corresponden a pagos de contado.
8. Qué costos adicionales corresponden a cada plazo MSI.
9. Si existen montos mínimos, máximos o restricciones comerciales.
10. Cómo y en qué plazos se liquidan los fondos al comercio.
11. Cómo se reflejan las comisiones en reportes y estados de cuenta.
12. Cómo se procesan anulaciones y reembolsos de operaciones MSI.
13. Qué capacidades de consulta, conciliación y reporte proporciona la afiliación.
14. Qué habilitación, pruebas o certificaciones adicionales se requieren.

**Dependencias técnicas abiertas (auditoría y diseño; sin migraciones ni código en este bloque)**
- Modelo de configuración de MSI bajo permisos de Dirección.
- Validación de elegibilidad desde el servidor.
- Compatibilidad de MSI con Microform, 3DS y el procesamiento bancario.
- Representación financiera del importe bruto, comisiones y liquidación neta.
- Conciliación de costos bancarios.
- Compatibilidad con el ledger append-only existente (hoy sin estructura de costos bancarios).
- Reportes financieros de costos por canal y modalidad.
- Tratamiento de reversas y reembolsos MSI.
- Concurrencia y protección contra sobrecobros.
- Compatibilidad con CS-D05, CS-D06 y CS-D07.
- Tratamiento de condiciones bancarias modificadas.
- Seguridad y auditoría de los cambios de política realizados por Dirección.

**Restricciones de implementación**
- Nada implementado, configurado ni activado. No se diseñan migraciones ni se propone código ejecutable.
- Las condiciones reales de la afiliación, tarifas y MSI siguen pendientes de confirmación bancaria.

### Decisiones abiertas (expresamente pendientes)

| Tema | Estado | Nota |
|---|---|---|
| Configuración real de la afiliación BanBajío (tarifas, MSI, capacidades) | ABIERTA | Captura conjunta, voids/reembolsos por API, webhooks, Decision Manager, tarjetas de prueba, comisiones y plazos MSI (ver tablas de dependencias en CS-D03 y CS-D08) |
| Cualquier otro punto bancario aún no resuelto | ABIERTA | Se añade aquí conforme aparezca |
| Dependencias técnicas pendientes de CS-D01 a CS-D08 | ABIERTAS | Listadas en cada decisión; se resuelven por auditoría y diseño técnico en bloques autorizados |

La política de comisiones y MSI quedó resuelta a nivel de producto en **CS-D08** (comisiones absorbidas por RENOVACELL; MSI solo por Dirección y solo con confirmación bancaria).

El cobro del saldo pendiente frente al total en el portal del doctor quedó resuelto en **CS-D07** (saldo pendiente real, completo, sin abonos libres).

CS-D03 pasó a **APROBADA A NIVEL DE PRODUCTO — IMPLEMENTACIÓN CONDICIONADA** el 2026-10-20 (ver arriba); sus dependencias bancarias siguen pendientes. CS-D05 pasó a **APROBADA A NIVEL DE PRODUCTO / IMPLEMENTACIÓN NO AUTORIZADA** el 2026-10-20; sus dependencias técnicas 1–10 siguen abiertas.

**Resumen de estados (2026-10-20):** CS-D01 APROBADA · CS-D02 DIRECCIÓN DE PRODUCTO DEFINIDA / VALIDACIÓN TÉCNICA PENDIENTE · CS-D03 APROBADA A NIVEL DE PRODUCTO / CONDICIONADA AL BANCO · CS-D04 APROBADA · CS-D05 APROBADA / DOCUMENTADA · CS-D06 APROBADA / DOCUMENTADA · CS-D07 APROBADA / DOCUMENTADA · CS-D08 APROBADA A NIVEL DE PRODUCTO / DOCUMENTADA / IMPLEMENTACIÓN NO AUTORIZADA · **CS-0: EN DISEÑO (no terminado)** · **CS-1: NO AUTORIZADO**.

---

## Parte II — Informe de auditoría (2026-10-20, preservado)

### 1. Estado real de RENOVACELL (hechos verificados)

| Pieza | Qué hay | Dónde |
|---|---|---|
| Arquitectura | React + Vite en `apps/web`; Supabase con migraciones y Edge Functions (Deno); frontend en Netlify | `docs/deploy.md` |
| Libro mayor de pagos (W2) | `payment_claims` (reportado / verificado / rechazado), `payment_entries` append-only, `money_operations` (op_id + hash de solicitud), vista `v_order_money` (saldo, liberado) | `supabase/migrations/20261013120000_w2_n1_schema.sql` |
| Antiduplicado de dinero | `uq_entry_external_ref` (una entrada por referencia externa), una reclamación abierta por pedido, op_id con bloqueo consultivo y replay seguro | `supabase/migrations/20261013120100_w2_n2_constraints.sql:71` |
| Cobro por proveedor | `registrar_cobro` acepta service_role (webhook), admin y billing. Solo el webhook de Stripe pone el pedido en `paid`; el surtido se libera por `liberado` | `supabase/migrations/20261122120000_sec_b_autorizacion_financiera.sql:43-46` |
| Integración Stripe | `stripe-checkout` (sesión Checkout, idempotencia por pedido) y `stripe-webhook` (firma, op_id derivado de la sesión, cobro al ledger). Ambos responden 501 sin secretos. Sin credenciales en prod | `supabase/functions/stripe-checkout/index.ts`, `supabase/functions/stripe-webhook/index.ts` |
| UI de pago del doctor | `PaymentModal` con transferencia y "Pagar ahora" con tarjeta (hoy a Stripe) | `apps/web/src/screens/doctor/PaymentModal.tsx:95`, `apps/web/src/screens/checkout/CheckoutCanonico.tsx:160-206` |
| Pagos en el ERP | Facturación (`registrar_cobro`), Pagos por validar (`revisar_pago`), Caja (`vender_pos`), cierre de caja | `apps/web/src/screens/admin/Facturacion.tsx:618`, `PagosPorValidar.tsx`, `screens/pos/Caja.tsx`, `CierreCaja.tsx` |
| Patrón de intentos ante proveedores | `shipping_attempts`: reclamar → llamar al proveedor → finalizar en una transacción; estados `failed_safe_to_retry` y `unknown_requires_reconciliation` | `supabase/functions/shipping/index.ts:374-455`, `supabase/migrations/20261011120000_shipping_p0.sql` |
| Roles y acceso | admin, doctor, warehouse, packing, pos, billing, driver, comm; `resolverQuien` / `tieneRol`; RLS en tablas de dinero con escritura solo por comandos SECURITY DEFINER | `supabase/functions/_shared/quien.ts` |
| Secretos y ambientes | `supabase secrets set` + `Deno.env`; registro de ambientes `HOSTS_T1` con llaves separadas por ambiente; CORS centralizado (`_shared/cors.ts`); observabilidad a Sentry (`_shared/observa.ts`) | `supabase/functions/shipping/t1.ts:27-63` |
| Auditoría | `audit_logs` append-only con trigger en pedidos; dinero auditado por `money_operations` | `supabase/migrations/20260706163027_audit_triggers.sql` |

**No existe:** links de pago, tabla de intentos de pago con tarjeta, CyberSource, BanBajío, reembolsos por proveedor, manejo de eventos de fallo o expiración de Stripe. `orders.stripe_payment_id` nunca se escribe.

### 2. Viabilidad técnica

Alta. Los tres pilares ya están: un ledger idempotente donde cae el cobro, un patrón probado de intento contra proveedor con reconciliación, y una UI de pago del doctor con el paso "Pagar ahora". CyberSource entra como un proveedor más que termina en `registrar_cobro`.

**Hechos verificados de CyberSource** (documentación oficial y muestras oficiales `CyberSource/cybersource-rest-samples-csharp`):
- Hosts: `apitest.cybersource.com` (sandbox) y `api.cybersource.com` (producción). Autenticación HTTP Signature con cabeceras `v-c-merchant-id`, `Date`, `Host`, `Digest`, `Signature`; HMAC-SHA256 con keyId y shared secret base64, creados en Business Center › Key Management.
- Microform v2: capture context en `POST /microform/v2/sessions` (`targetOrigins`, `allowedCardNetworks`, `clientVersion`) → JWT; la librería de CyberSource aloja los campos de tarjeta en iframes propios; el token transitorio vale 15 minutos o hasta la primera autorización. El PAN nunca toca nuestro frontend ni nuestro servidor.
- 3DS en cinco pasos: `/risk/v1/authentication-setups` → recolección de datos del dispositivo (iframe oculto) → `/risk/v1/authentications` (enrolamiento) → step-up por iframe (`stepUpUrl` + `accessToken`; la `returnUrl` recibe `TransactionId`) → `/risk/v1/authentication-results`. Estados: `AUTHENTICATION_SUCCESSFUL`, `PENDING_AUTHENTICATION`, `AUTHENTICATION_FAILED`. La validación puede ir dentro de la autorización con `processingInformation.actionList = VALIDATE_CONSUMER_AUTHENTICATION`.
- Pagos: `POST /pts/v2/payments` con `tokenInformation.transientTokenJwt` y `processingInformation.capture` true/false; reversals, captures, refunds y voids por recurso; `clientReferenceInformation.code` como referencia de comercio. Webhooks por suscripción existen en CyberSource; su disponibilidad en la afiliación de BanBajío **no** está confirmada.

### 3. Arquitectura propuesta (propuesta, NO implementada)

**Reutilizable:** `registrar_cobro` y el ledger; `v_order_money` para cobrar el saldo real; `PaymentModal` y "Pagar ahora"; `resolverQuien`, `conCors`, `observa`; registro de ambientes estilo `HOSTS_T1`; patrón `shipping_attempts`.

**Nuevo:**
- Edge Function `cybersource` con acciones `capture_context`, `3ds_setup`, `3ds_enroll`, `3ds_validate_and_pay`, `status`. Toda firma HTTP y todo secreto viven aquí.
- Edge Function `cybersource-return` (returnUrl del reto 3DS): recibe el `TransactionId` y lo asocia al intento.
- Tabla `card_payment_attempts`: un intento activo por pedido; estados `created → context_issued → 3ds_pending → 3ds_challenge → authorized / captured / declined / failed_safe_to_retry / unknown_requires_reconciliation`; guarda ids de CyberSource, monto, moneda, resultado 3DS (eci, cavv). **Nunca PAN ni CVV.**
- RPCs `iniciar_intento_tarjeta` y `cerrar_intento_tarjeta`; en éxito llaman `registrar_cobro` con op_id derivado del `transactionId` y `external_ref = transactionId` (`uq_entry_external_ref` impide doble cobro).
- En `PaymentModal`, opción "Tarjeta (BanBajío)" que monta Microform e iframes 3DS. Stripe queda intacto.

**Flujo frontend:** doctor verificado elige tarjeta → capture context → Microform → token transitorio → setup 3DS + iframe de dispositivo → enrolamiento → step-up si hay reto → validar y pagar → el resultado mostrado es el estado del ledger, no lo que diga el navegador.

**Flujo backend:** reclamar intento → capture context firmado → setup y enrolamiento con el token y el saldo del pedido → validación + autorización en una llamada → `AUTHORIZED`: registrar cobro y cerrar intento en una transacción; `DECLINED`: cerrar como rechazado; timeout o ambigüedad: `unknown_requires_reconciliation`, sin reintento automático. Captura inmediata o diferida según lo habilitado por BanBajío.

**Ambientes:** registro `HOSTS_CS` (test / production); secretos separados `CS_API_ENV`, `CS_MERCHANT_ID`, `CS_KEY_ID`, `CS_SHARED_SECRET` (sandbox) y `CS_LIVE_*` (producción); relleno rechazado; producción bloqueada por código hasta autorización (como T1).

**Seguridad:** shared secret solo en la Edge; `targetOrigins` limitado a los hosts del portal; validación de firma del JWT de capture context y del token transitorio con las llaves públicas de CyberSource; solo doctor verificado paga su propio pedido; reembolsos y anulaciones solo Dirección; todo queda en `money_operations` y en la tabla de intentos; prohibido registrar cuerpos de respuesta completos (PCI SAQ A).

### 4. Dependencias de BanBajío

- Afiliación y Merchant ID de sandbox y luego de producción.
- Credenciales REST (shared secret, keyId, merchantId) por ambiente.
- Confirmar habilitación de Microform v2, Payer Authentication y Decision Manager.
- Tarjetas de prueba 3DS y acceso al Business Center de sandbox.
- Confirmar si webhooks y reembolsos por API están habilitados.
- Confirmar captura inmediata vs diferida y la ventana de captura.

### 5. Riesgos y controles

- **Doble cobro:** intento único por pedido + `external_ref` único en el ledger.
- **Resultado desconocido por timeout:** estado de reconciliación; consulta de estado por id de transacción antes de cualquier reintento.
- **Falso éxito:** el frontend nunca marca pagado; solo la Edge con la respuesta de CyberSource y el ledger.
- **Monto manipulado:** el monto sale de `v_order_money` en el servidor.
- **Cumplimiento PCI:** Microform mantiene a RENOVACELL en SAQ A mientras ningún dato de tarjeta pase por nuestro código.
- **Conciliación:** reporte diario del Business Center o búsqueda de transacciones contra `payment_entries.external_ref`.

### 6. Plan por bloques (ninguno autorizado)

| Bloque | Objetivo | Requiere sandbox | Criterio de aceptación |
|---|---|---|---|
| CS-0 | Cerrar decisiones de producto y contrato con BanBajío | No | Decisiones registradas (Parte I) y confirmaciones del banco |
| CS-1 | Firma HTTP Signature y registro de ambientes en la Edge, sin red | No | Pruebas unitarias de firma contra ejemplos oficiales; producción bloqueada |
| CS-2 | Tabla y RPCs de intentos, con rollback y pruebas de base | No | Un intento activo por pedido; el cierre llama `registrar_cobro` con op_id derivado |
| CS-3 | Capture context y Microform en `PaymentModal` | Sí | Token transitorio obtenido en sandbox sin que el PAN pase por nosotros |
| CS-4 | 3DS: setup, enrolamiento, step-up, validación | Sí | Frictionless, reto, fallo y abandono cubiertos con tarjetas de prueba |
| CS-5 | Autorización + captura y cobro al ledger | Sí | Un pago sandbox termina en `payment_entries` una sola vez aunque se repita |
| CS-6 | Estado, timeouts, reconciliación y pantalla de revisión | Sí | Una transacción ambigua queda en reconciliación y se resuelve por consulta de estado |
| CS-7 | Reembolsos y anulaciones (CS-D03) | Sí, si el banco lo habilita | Solo Dirección; reflejado en `refunds` y en el ledger |

**Recomendación:** aprobar CS-0 y CS-1 juntos. CS-0 porque el diseño de CS-5 y CS-7 cambia según lo que BanBajío habilite. CS-1 porque se construye y prueba hoy sin credenciales ni red.

### 7. Preguntas abiertas de la auditoría

- ¿`portal.renovacell.mx` será el único origen de Microform (`targetOrigins`)?
- ¿Caja usará terminal física del banco en lugar de CyberSource?
- ¿Decision Manager viene incluido en la afiliación?

---

## Bitácora del frente

| Fecha | Evento |
|---|---|
| 2026-10-20 | Auditoría READ-ONLY entregada. Sin cambios funcionales. |
| 2026-10-20 | CS-0A: registradas CS-D01, CS-D02 y CS-D04; CS-D03 y demás decisiones abiertas. CS-0 EN DISEÑO, NO CERRADO. CS-1 NO AUTORIZADO. |
| 2026-10-20 | CS-0B: CS-D03 registrada como APROBADA A NIVEL DE PRODUCTO — IMPLEMENTACIÓN CONDICIONADA A CAPACIDADES DEL BANCO (anulaciones, reembolsos totales/parciales/múltiples, estados, vía manual, 9 dependencias bancarias). Auditado el soporte actual del ledger (`refunds`, `autorizar_reembolso`, `pagar_reembolso`, `reversar_asiento`, `v_order_money`). Sin cambios funcionales. CS-0 EN DISEÑO. CS-1 NO AUTORIZADO. |
| 2026-10-20 | CS-0C: CS-D05 (links de pago para pedidos y cobros independientes) registrada como APROBADA A NIVEL DE PRODUCTO / IMPLEMENTACIÓN NO AUTORIZADA: alcance, importes fijados, vigencia 24 h configurable, permisos por rol validados en servidor, distribución (copiar, WhatsApp prellenado, correo con registro), uso único con reintentos controlados, cambios de importe, múltiples enlaces con reservas solo por operación iniciada, conciliación idempotente; 10 dependencias técnicas abiertas. Sin cambios funcionales. CS-0 EN DISEÑO (links cerrados, no terminado). CS-1 NO AUTORIZADO. |
| 2026-10-20 | CS-0D: CS-D06 (cobros presenciales en Caja/POS) registrada como APROBADA A NIVEL DE PRODUCTO / DOCUMENTADA / IMPLEMENTACIÓN NO AUTORIZADA: tres modalidades (terminal integrada bidireccional condicionada al banco, QR/enlace presencial sobre CS-D05, terminal externa con registro controlado), confirmación financiera estricta, registro de pagos externos con evidencia y validación separadas, pagos mixtos y parciales sin alterar políticas de entrega/crédito, correcciones administrativas separadas de reembolsos CS-D03, terminal bidireccional como experiencia objetivo; 14 dependencias técnicas y bancarias abiertas. Sin cambios funcionales. CS-0 EN DISEÑO. CS-1 NO AUTORIZADO. |
| 2026-10-20 | CS-0E: CS-D07 (cobro seguro del saldo pendiente en el portal del doctor) registrada como APROBADA A NIVEL DE PRODUCTO / DOCUMENTADA / IMPLEMENTACIÓN NO AUTORIZADA: solo saldo pendiente real y completo (sin abonos libres del doctor), recálculo en servidor antes de cada cargo, estados Pagado / Pendiente de verificación, recuperación de operaciones interrumpidas desde el servidor, checkout integrado (Microform v2 + 3DS, confirmación en servidor), concurrencia entre canales con reconfirmación del importe, reutilización de PaymentModal / v_order_money / registrar_cobro sujeta a verificación, Stripe preservado; 12 dependencias técnicas abiertas. Sin cambios funcionales. CS-0 EN DISEÑO. CS-1 NO AUTORIZADO. |
| 2026-10-20 | CS-0F: CS-D08 (comisiones bancarias y MSI) registrada como APROBADA A NIVEL DE PRODUCTO / DOCUMENTADA / IMPLEMENTACIÓN NO AUTORIZADA: comisiones absorbidas por RENOVACELL como costo interno (sin recargos al doctor, bruto/comisión/neto registrados por separado, conciliación), MSI solo por Dirección y solo con confirmación bancaria (plazos, mínimos, canales; validación en servidor; costos absorbidos; sin crédito directo), invariantes de importe y conciliación, experiencia del doctor con plazos solo ilustrativos; 14 dependencias bancarias y 12 técnicas abiertas. Sin cambios funcionales. CS-0 EN DISEÑO. CS-1 NO AUTORIZADO. |
| 2026-10-22 | CS-1A.7-FIX (LOCAL, sin commit): eliminada la regla insegura de conciliación (cerrar como "fallo seguro" un desconocido por 30 min sin transacciones). Migración 187 `20270109120000_cs1a7_cierre_manual.sql`: `cs_intento_avanzar` rechaza `unknown → failed_safe_to_retry` para todos (CIERRE_MANUAL_REQUERIDO) y exige a las personas los hechos del proveedor (`proveedor`) para entrar a authorized/captured (PROVEEDOR_REQUERIDO); nueva RPC `cs_intento_cerrar_manual` solo admin/billing (service_role sin grant), ≥ 24 h desde lo más tardío entre envío y estado, consulta reciente (≤ 30 min) por id y por referencia sin transacciones, Business Center revisado, motivo ≥ 10, responsable y consulta en la bitácora. Edge `cs-conciliar`: `decidirResolucion` sin umbral de minutos (sin transacciones = sin cambio, reserva conservada), acción `cerrar_manual` (24 h antes de tocar al banco; las dos consultas realizadas en ese momento; hallazgo o error del proveedor = no se cierra), envío sin respuesta pasa a desconocido solo tras 5 min. UI: bloque "Cierre manual sin cargo" con casilla de Business Center. Rollback `supabase/rollback/cs1a7_cierre_manual/99_down.sql` + cadena `cs1a7_rollback.sql`; cadenas cs1a/cs1b/W1/W2 bajan la 187 primero. Pruebas locales: DB cs1a7 48 + concurrencia 11 + rollback 7; suites CS previas ajustadas al nuevo contrato. NO desplegado. |
